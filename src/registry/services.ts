// サービスの登録表。計算の中身は network の側に残し、定義は入口（達成条件・シーケンス図・論点）を ID で指す。
import type { LangKey } from '../generated/lang-keys';
import type { ErrorId } from '../network/topics';
import type { Service } from '../network/types';
import { Registry } from './registry';

// TCP で受けるサービスの口の名前
export type TcpService = 'smtp' | 'imap' | 'smb';

export interface ServicePort {
  name: TcpService;
  port: number;
  // ファイアウォールの規則の選択肢の文言
  label: LangKey;
}

// 設定の項目。domain は受け持つメールのドメイン
export interface ServiceField {
  key: 'domain';
  label: LangKey;
}

export interface ServiceDef {
  // 機器のサービスの protocol が、この ID を指す
  id: Extract<Service['protocol'], 'mail' | 'nas'>;
  // 機器の設定の欄の見出し
  label: LangKey;
  // サーバーの絵に重ねる役割の印
  icon: string;
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
    label: 'ui.service.mail',
    icon: 'icon/svc_mail',
    ports: [
      { name: 'smtp', port: 25, label: 'ui.fw.service.smtp' },
      { name: 'imap', port: 143, label: 'ui.fw.service.imap' },
    ],
    fields: [{ key: 'domain', label: 'ui.service.mailDomain' }],
    failures: ['mail.no_server', 'mail.no_mx', 'mail.relay_failed', 'mail.unknown_domain'],
    goal: 'mail',
    sequence: 'mail',
    topic: 'mail',
  },
  { id: 'nas', label: 'ui.service.nas', icon: 'icon/svc_nas', ports: [{ name: 'smb', port: 445, label: 'ui.fw.service.smb' }], fields: [], failures: [], goal: 'nas', sequence: null, topic: null },
];

// 設定の項目を持たず、入切だけで動かすサービス
export type ToggleServiceId = 'nas';

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

// TCP の口をすべて（登録の順）
export const tcpPorts = (): readonly ServicePort[] => services.all().flatMap((s) => s.ports);
