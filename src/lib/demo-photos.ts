// Fotos ilustrativas dos itens de exemplo, de acervos abertos (Wikimedia Commons).
// Gerado a partir de docs/fotos-demo-creditos.json. Cada foto mostra o tipo de prato,
// não um prato de um restaurante de verdade; os créditos aparecem em /creditos-das-fotos.

export interface DemoPhoto {
  src: string;
  title: string;
  creator: string;
  license: string;
  licenseUrl: string | null;
  page: string;
}

export const DEMO_PHOTOS: Record<string, DemoPhoto> = {
  "p-batata": {
    "src": "/demo/fotos/batata-frita.jpg",
    "title": "French fries 3",
    "creator": "Sri2161k",
    "license": "CC BY-SA 4.0",
    "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0",
    "page": "https://commons.wikimedia.org/wiki/File:French_fries_3.jpg"
  },
  "p-isca": {
    "src": "/demo/fotos/isca-de-peixe.jpg",
    "title": "Fishfinger classic fried 1",
    "creator": "Superbass",
    "license": "CC BY-SA 4.0",
    "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0",
    "page": "https://commons.wikimedia.org/wiki/File:Fishfinger_classic_fried_1.jpg"
  },
  "p-bolinho": {
    "src": "/demo/fotos/bolinho-de-bacalhau.jpg",
    "title": "Bolinho de bacalhau da vovó (16079982696)",
    "creator": "Christian Benseler",
    "license": "CC BY 2.0",
    "licenseUrl": "https://creativecommons.org/licenses/by/2.0",
    "page": "https://commons.wikimedia.org/wiki/File:Bolinho_de_bacalhau_da_vov%C3%B3_(16079982696).jpg"
  },
  "p-pastel": {
    "src": "/demo/fotos/pastel.jpg",
    "title": "Pastel de Feira 01",
    "creator": "Avelludo",
    "license": "CC BY-SA 4.0",
    "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0",
    "page": "https://commons.wikimedia.org/wiki/File:Pastel_de_Feira_01.jpg"
  },
  "p-torresmo": {
    "src": "/demo/fotos/torresmo.jpg",
    "title": "Pork prrr",
    "creator": "Biser Todorov",
    "license": "CC BY 4.0",
    "licenseUrl": "https://creativecommons.org/licenses/by/4.0",
    "page": "https://commons.wikimedia.org/wiki/File:Pork_prrr.jpg"
  },
  "p-moqueca": {
    "src": "/demo/fotos/moqueca.jpg",
    "title": "Moqueca",
    "creator": "BR",
    "license": "CC BY-SA 4.0",
    "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0",
    "page": "https://commons.wikimedia.org/wiki/File:Moqueca.jpg"
  },
  "p-baiao": {
    "src": "/demo/fotos/baiao-de-dois.jpg",
    "title": "Baião de dois",
    "creator": "Zé Carlos Barretta",
    "license": "CC BY 2.0",
    "licenseUrl": "https://creativecommons.org/licenses/by/2.0",
    "page": "https://commons.wikimedia.org/wiki/File:Bai%C3%A3o_de_dois.jpg"
  },
  "p-parmegiana": {
    "src": "/demo/fotos/parmegiana.jpg",
    "title": "Bife a parmegiana com arroz e batata frita",
    "creator": "Márcia Cristina Machado",
    "license": "CC BY-SA 4.0",
    "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0",
    "page": "https://commons.wikimedia.org/wiki/File:Bife_a_parmegiana_com_arroz_e_batata_frita.jpg"
  },
  "p-pernil": {
    "src": "/demo/fotos/sanduiche-de-pernil.jpg",
    "title": "Sanduiche de pernil e suco de laranja (5892293245)",
    "creator": "Monica Kaneko from Sao Paulo, Brasil",
    "license": "CC BY-SA 2.0",
    "licenseUrl": "https://creativecommons.org/licenses/by-sa/2.0",
    "page": "https://commons.wikimedia.org/wiki/File:Sanduiche_de_pernil_e_suco_de_laranja_(5892293245).jpg"
  },
  "p-burger": {
    "src": "/demo/fotos/hamburguer.jpg",
    "title": "Cheeseburger",
    "creator": "Renee Comet (photographer)",
    "license": "public domain",
    "licenseUrl": "https://creativecommons.org/publicdomain/mark/1.0/",
    "page": "https://commons.wikimedia.org/wiki/File:Cheeseburger.jpg"
  },
  "p-cerveja": {
    "src": "/demo/fotos/cerveja.jpg",
    "title": "Beer bottles 2018 G1",
    "creator": "George Chernilevsky",
    "license": "public domain",
    "licenseUrl": "https://creativecommons.org/publicdomain/mark/1.0/",
    "page": "https://commons.wikimedia.org/wiki/File:Beer_bottles_2018_G1.jpg"
  },
  "p-caipirinha": {
    "src": "/demo/fotos/caipirinha.jpg",
    "title": "Caipirinha with lime",
    "creator": "rawpixel.com",
    "license": "CC0",
    "licenseUrl": "https://creativecommons.org/publicdomain/zero/1.0/deed.en",
    "page": "https://commons.wikimedia.org/wiki/File:Caipirinha_with_lime.jpg"
  },
  "p-suco": {
    "src": "/demo/fotos/suco.jpg",
    "title": "Suco de abacaxi com caju - pineapple and cashew juice - (30332667533)",
    "creator": "Fernando Cesar Nox from Jundiaí, Brasil",
    "license": "CC BY 2.0",
    "licenseUrl": "https://creativecommons.org/licenses/by/2.0",
    "page": "https://commons.wikimedia.org/wiki/File:Suco_de_abacaxi_com_caju_-_pineapple_and_cashew_juice_-_(30332667533).jpg"
  },
  "p-pudim": {
    "src": "/demo/fotos/pudim.jpg",
    "title": "Pudim de leite (3544235183)",
    "creator": "Marcelo Träsel from Porto Alegre, Brasil",
    "license": "CC BY-SA 2.0",
    "licenseUrl": "https://creativecommons.org/licenses/by-sa/2.0",
    "page": "https://commons.wikimedia.org/wiki/File:Pudim_de_leite_(3544235183).jpg"
  },
  "p-cartola": {
    "src": "/demo/fotos/cartola.jpg",
    "title": "10-2025 Cartola",
    "creator": "1996rojas",
    "license": "CC BY-SA 4.0",
    "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0",
    "page": "https://commons.wikimedia.org/wiki/File:10-2025_Cartola.jpg"
  }
};

export const DEMO_PHOTO_PREFIX = "/demo/fotos/";
