// サービスの登録表。計算の中身は network の側に残し、定義は入口（達成条件・シーケンス図・論点）を ID で指す。
import type { ErrorId } from '../network/topics';
import type { Service } from '../network/types';
import { Registry } from './registry';

// TCP で受けるサービスの口の名前
export type TcpService = 'smtp' | 'imap' | 'smb';

export interface ServicePort {
  name: TcpService;
  port: number;
}

// 設定の項目。domain は受け持つメールのドメイン
export interface ServiceField {
  key: 'domain';
}

export interface ServiceDef {
  // 機器のサービスの protocol が、この ID を指す
  id: Extract<Service['protocol'], 'mail' | 'nas'>;
  ports: readonly ServicePort[];
  fields: readonly ServiceField[];
  failures: readonly ErrorId[];
  // 達成条件の種類（goals.ts のハンドラ）
  goal: 'mail' | 'nas';
  // シーケンス図の種類（ControlTrigger の kind）。図がなければ null
  sequence: 'mail' | null;
  // 解放の帯を持つ論点（topics.ts の id）。論点がなければ null
  topic: 'mail' | null;
}

const DEFS: readonly ServiceDef[] = [
  {
    id: 'mail',
    ports: [
      { name: 'smtp', port: 25 },
      { name: 'imap', port: 143 },
    ],
    fields: [{ key: 'domain' }],
    failures: ['mail.no_server', 'mail.no_mx', 'mail.relay_failed', 'mail.unknown_domain'],
    goal: 'mail',
    sequence: 'mail',
    topic: 'mail',
  },
  { id: 'nas', ports: [{ name: 'smb', port: 445 }], fields: [], failures: [], goal: 'nas', sequence: null, topic: null },
];

export const services = new Registry<ServiceDef>('サービス');
for (const d of DEFS) services.register(d);
services.freeze();

// 口の名前を受け持つサービス。どのサービスも受け持たなければ例外
export const serviceOfPort = (name: TcpService): ServiceDef => {
  const def = services.all().find((s) => s.ports.some((p) => p.name === name));
  if (def === undefined) throw new Error(`口を受け持つサービスがない: ${name}`);
  return def;
};

// 口の番号
export const servicePort = (name: TcpService): number => serviceOfPort(name).ports.find((p) => p.name === name)!.port;
