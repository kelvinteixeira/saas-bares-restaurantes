"use client";

// Entregadores: cadastro (dono e gerente) e a escolha do entregador do pedido (dono, gerente e caixa).
// Na loja do Supabase quem decide é o banco (SQL 009); na loja local, as mesmas regras.

import type { Driver } from "@/lib/types";
import { payFor } from "@/lib/domain/drivers";
import { onlyDigits } from "@/lib/format";
import { newId } from "@/lib/ids";
import { getDb, mutate } from "@/lib/store/db";
import { friendly, isRemoteStore, remoteRemoveDriver, remoteUpsertDriver, remoteUpsertOrder } from "@/lib/store/remote";
import { driverToRow, rowToDriver, rowToOrder, type DriverRow, type OrderRow } from "@/lib/store/mappers";
import { getSupabase } from "@/lib/supabase/client";

export class DriverError extends Error {}

function remoteError(error: { code?: string; message?: string } | null, fallback: string): DriverError {
  if (error?.code === "PGRST202" || error?.code === "PGRST205" || error?.code === "42883" || error?.code === "42P01") {
    return new DriverError("Os entregadores ainda não estão ligados no banco. Rode o arquivo supabase/migrations/009_entregadores.sql no Supabase.");
  }
  if (error?.code === "P0001" && error.message) return new DriverError(error.message);
  return new DriverError(friendly(error, fallback).message);
}

export function newDriver(storeId: string): Driver {
  return { id: newId(), storeId, name: "", phone: "", payKind: "fee", payAmount: 0, active: true, createdAt: new Date().toISOString() };
}

export async function saveDriver(input: Driver): Promise<Driver> {
  const driver = { ...input, name: input.name.trim().slice(0, 60), phone: onlyDigits(input.phone) };
  if (!driver.name) throw new DriverError("Diga o nome do entregador.");
  if (driver.phone && (driver.phone.length < 10 || driver.phone.length > 11)) throw new DriverError("WhatsApp com DDD, ou deixe em branco.");
  if (driver.payKind === "fixed" && driver.payAmount <= 0) throw new DriverError("Informe quanto ele recebe por entrega.");
  if (isRemoteStore(driver.storeId)) {
    const { data, error } = await getSupabase().from("drivers").upsert(driverToRow(driver)).select().single<DriverRow>();
    if (error || !data) throw remoteError(error, "Não foi possível salvar o entregador.");
    const saved = rowToDriver(data);
    remoteUpsertDriver(saved);
    return saved;
  }
  return mutate((db) => {
    db.drivers ??= [];
    const i = db.drivers.findIndex((d) => d.id === driver.id);
    if (i >= 0) db.drivers[i] = driver;
    else db.drivers.push(driver);
    return driver;
  });
}

export async function deleteDriver(driver: Driver): Promise<void> {
  if (isRemoteStore(driver.storeId)) {
    const { error } = await getSupabase().from("drivers").delete().eq("id", driver.id);
    if (error) throw remoteError(error, "Não foi possível apagar o entregador.");
    remoteRemoveDriver(driver.id);
    return;
  }
  mutate((db) => {
    db.drivers = (db.drivers ?? []).filter((d) => d.id !== driver.id);
    for (const o of db.orders) if (o.driverId === driver.id) delete o.driverId;
  });
}

/** Escolhe (ou tira, com null) o entregador do pedido. */
export async function assignDriver(orderId: string, driverId: string | null): Promise<void> {
  const order = getDb().orders.find((o) => o.id === orderId);
  if (!order) throw new DriverError("Pedido não encontrado.");
  if (isRemoteStore(order.storeId)) {
    const { data, error } = await getSupabase().rpc("assign_driver", { p_order: orderId, p_driver: driverId });
    if (error || !data) throw remoteError(error, "Não foi possível escolher o entregador.");
    remoteUpsertOrder(rowToOrder(data as OrderRow));
    return;
  }
  mutate((db) => {
    const o = db.orders.find((x) => x.id === orderId)!;
    if (o.mode !== "delivery") throw new DriverError("Só pedido de entrega tem entregador.");
    if (o.status === "cancelado") throw new DriverError("Este pedido foi cancelado.");
    if (!driverId) {
      delete o.driverId;
      delete o.driverPay;
      return;
    }
    const d = (db.drivers ?? []).find((x) => x.id === driverId && x.storeId === o.storeId);
    if (!d) throw new DriverError("Entregador não encontrado.");
    if (!d.active && o.driverId !== d.id) throw new DriverError(`${d.name} está desativado.`);
    o.driverId = d.id;
    o.driverPay = payFor(d, o);
  });
}
