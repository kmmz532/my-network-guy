// 配置された機器と配線の形式（セーブデータとシミュレーションの入力を兼ねる）
export interface Iface {
  port: number;
  ip: string;
  prefix: number;
}

export interface Route {
  dest: string;
  prefix: number;
  nextHop: string;
}

export interface Service {
  protocol: 'http';
  port: number;
}

export interface NetNode {
  uid: string;
  device: string;
  x: number;
  y: number;
  // 配置を動かせない（案件で固定された機器）
  locked: boolean;
  // 設定（IPアドレスなど）を変えられない
  configLocked: boolean;
  interfaces: Iface[];
  gateway: string | null;
  routes: Route[];
  services: Service[];
}

export interface Endpoint {
  node: string;
  port: number;
}

export interface NetLink {
  uid: string;
  cable: string;
  a: Endpoint;
  b: Endpoint;
  path: [number, number][];
}

// セグメントの設定（ネットワークアドレスとプレフィックス長）
export interface SegmentConfig {
  network: string;
  prefix: number;
}

export interface Network {
  nodes: NetNode[];
  links: NetLink[];
  // セグメントの設定（代表端点の鍵 "uid:port" → 設定）。省略すると設定はない
  segments?: Record<string, SegmentConfig>;
}

// 判定に必要なデータ（機材の種類と、ケーブルの上限長）
export interface EngineData {
  categoryOf: (device: string) => string;
  maxLengthOf: (cable: string) => number;
}

// 疎通の失敗の理由。文言は言語ファイルの error.<理由> と error.<理由>.fix に置く
export const FAILURE_REASONS = [
  'link.unplugged',
  'link.too_long',
  'ip.unset',
  'ip.duplicate',
  'ip.unreachable',
  'gateway.unset',
  'gateway.unreachable',
  'route.none',
  'route.loop',
  'return.failed',
  'service.closed',
] as const;

export type FailureReason = (typeof FAILURE_REASONS)[number];

export interface Failure {
  reason: FailureReason;
  node: string;
  // return.failed のときに、復路で起きた失敗
  cause?: Failure;
}

export interface PathResult {
  ok: boolean;
  // 往路で通過した機器のuid（L2スイッチは含めない）
  path: string[];
  failure?: Failure;
}
