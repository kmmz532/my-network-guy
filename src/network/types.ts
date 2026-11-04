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
  locked: boolean;
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

export interface Network {
  nodes: NetNode[];
  links: NetLink[];
}

// 判定に必要なデータ（機材の種類と、ケーブルの上限長）
export interface EngineData {
  categoryOf: (device: string) => string;
  maxLengthOf: (cable: string) => number;
}

export type FailureReason =
  | 'link.unplugged'
  | 'link.too_long'
  | 'ip.unset'
  | 'ip.duplicate'
  | 'ip.unreachable'
  | 'gateway.unset'
  | 'gateway.unreachable'
  | 'route.none'
  | 'route.loop'
  | 'return.failed'
  | 'service.closed';

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
