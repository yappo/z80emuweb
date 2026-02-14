// ハードウェア仕様の根拠情報。ID は map 定義側で参照される。
export interface HardwareEvidence {
  id: string;
  title: string;
  url: string;
  notes: string;
}

export const PCG815_EVIDENCE = [
  {
    id: 'z88dk-platform-sharp-pc',
    title: 'z88dk Platform - Sharp PC',
    url: 'https://github-wiki-see.page/m/z88dk/z88dk/wiki/Platform---Sharp-PC',
    notes: 'PC-G815 class display model and target-family compatibility notes.'
  },
  {
    id: 'ashitani-g850-general',
    title: 'PC-G850V Programming Note - General Info',
    url: 'https://ashitani.jp/g850/docs/01_general_info.html',
    notes: 'Community memory map baseline for G800/G850 compatible family.'
  },
  {
    id: 'akiyan-g850-tech',
    title: 'PC-G850 Technical Data',
    url: 'https://www.akiyan.com/pc-g850_technical_data',
    notes: 'Reverse-engineering notes on work areas, I/O, and keyboard behavior.'
  },
  {
    id: 'pokecom-basic-samples',
    title: 'POKE COM BASIC Samples',
    url: 'https://poke-com.jimdofree.com/basic-%E3%83%97%E3%83%AD%E3%82%B0%E3%83%A9%E3%83%A0/',
    notes: 'Observed BASIC examples using OUT &H58 and OUT &H5A LCD ports.'
  },
  {
    id: 'ver0-doc-index',
    title: 'Version 0 Document Index',
    url: 'https://ver0.sakura.ne.jp/doc/index.html',
    notes: 'Index for IOCS/work-area references in G800 family.'
  },
  {
    id: 'ver0-root',
    title: 'Version 0 Root',
    url: 'https://ver0.sakura.ne.jp/',
    notes: 'Project root linking G800/G800.js/G800a emulation references.'
  },
  {
    id: 'ver0-js',
    title: 'Version 0 JavaScript Edition',
    url: 'https://ver0.sakura.ne.jp/js/index.html',
    notes: 'Browser-oriented implementation reference for G800 series.'
  },
  {
    id: 'ver0-android',
    title: 'Version 0 Android Edition',
    url: 'https://ver0.sakura.ne.jp/android/',
    notes: 'Source distribution path for Android emulator variant.'
  },
  {
    id: 'mame-pce220-metadata',
    title: 'MAME PCE220 Machine Metadata',
    url: 'https://data.spludlow.co.uk/mame/machine/pce220',
    notes: 'Machine-level metadata for sibling model used as derived evidence.'
  },
  {
    id: 'wikipedia-pce220',
    title: 'Sharp PC-E220 Overview',
    url: 'https://en.wikipedia.org/wiki/Sharp_PC-E220',
    notes: 'Auxiliary context for sibling hardware lineage (derived only).'
  }
] as const satisfies readonly HardwareEvidence[];

export type HardwareEvidenceId = (typeof PCG815_EVIDENCE)[number]['id'];

const evidenceById = new Map(PCG815_EVIDENCE.map((entry) => [entry.id, entry]));

// 参照 ID から根拠メタデータを取得する。
export function getHardwareEvidence(id: HardwareEvidenceId): HardwareEvidence {
  const entry = evidenceById.get(id);
  if (!entry) {
    throw new Error(`Unknown hardware evidence id: ${id}`);
  }
  return entry;
}
