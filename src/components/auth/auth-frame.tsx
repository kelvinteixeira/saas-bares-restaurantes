import Link from "next/link";
import { Wordmark } from "@/components/brand/mark";

export function AuthFrame({
  title,
  subtitle,
  children,
  aside,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  aside: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-ground lg:grid lg:grid-cols-[1fr_520px]">
      <div className="flex flex-col px-4 py-4 sm:px-8 lg:py-6">
        <Link href="/" className="w-fit">
          <Wordmark />
        </Link>
        <div className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center py-10">
          <h1 className="text-[24px] leading-8 font-semibold tracking-[-0.01em]">{title}</h1>
          <p className="mt-2 text-[15px] leading-6 text-muted">{subtitle}</p>
          <div className="mt-8">{children}</div>
        </div>
      </div>
      <div className="hidden p-2 lg:block">
        <div className="flex h-full flex-col justify-end rounded-sheet border border-line bg-surface p-8">{aside}</div>
      </div>
    </div>
  );
}
