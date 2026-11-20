// サービスの登録表。計算の中身は network の側に残し、定義は入口（達成条件・シーケンス図・論点）を ID で指す。
import type { LangKey } from '../generated/lang-keys';
import type { ErrorId } from '../network/topics';
import type { Service } from '../network/types';
import { Registry } from './registry';

// TCP で受けるサービスの口の名前
export type TcpService = 'smtp' | 'imap' | 'smb';
// ファイアウォールの規則で選べる口の名前
export type PortName = 'http' | 'dns' | 'radius' | TcpService;

export interface ServicePort {
  name: PortName;
  // 番号を設定で変えられる口（http）は既定の番号
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
  id: Service['protocol'];
  // 機器の設定の欄の見出し
  label: LangKey;
  // サーバーの役割の名前（「Webサーバー」など）
  roleName: LangKey;
  // サーバーの絵に重ねる役割の印。印を出さないサービスは null
  icon: string | null;
  ports: readonly ServicePort[];
  fields: readonly ServiceField[];
  // 入切だけで起動するときの初期の形。設定の項目から作るサービス（mail・dns）は null
  initial: Service | null;
  // 設定の欄を専用の部品で描くサービスは true。ほかは登録表から行を並べる
  customEditor: boolean;
  failures: readonly ErrorId[];
  // 達成条件の種類（goals.ts のハンドラ）。なければ null
  goal: 'mail' | 'nas' | null;
  // シーケンス図の種類（ControlTrigger の kind）。図がなければ null
  sequence: 'mail' | 'http' | null;
  // 解放の帯を持つ論点（topics.ts の id）。論点がなければ null
  topic: 'mail' | 'dns' | 'proxy' | null;
}

const DEFS: readonly ServiceDef[] = [
  {
    id: 'http',
    label: 'ui.service.http',
    roleName: 'ui.node.role.web',
    icon: 'icon/svc_web',
    ports: [{ name: 'http', port: 80, label: 'ui.fw.service.http' }],
    fields: [],
    initial: { protocol: 'http', port: 80 },
    customEditor: false,
    failures: [],
    goal: null,
    sequence: 'http',
    topic: null,
  },
  {
    id: 'dns',
    label: 'ui.dns.title',
    roleName: 'ui.node.role.dns',
    icon: 'icon/svc_dns',
    ports: [{ name: 'dns', port: 53, label: 'ui.fw.service.dns' }],
    fields: [],
    initial: null,
    customEditor: true,
    failures: ['name.unresolved'],
    goal: null,
    sequence: null,
    topic: 'dns',
  },
  {
    id: 'radius',
    label: 'ui.service.radius',
    roleName: 'ui.node.role.radius',
    icon: null,
    ports: [{ name: 'radius', port: 1812, label: 'ui.fw.service.radius' }],
    fields: [],
    initial: { protocol: 'radius' },
    customEditor: false,
    failures: ['wlan.no_radius'],
    goal: null,
    sequence: null,
    topic: null,
  },
  {
    id: 'proxy',
    label: 'ui.service.proxy',
    roleName: 'ui.node.role.proxy',
    icon: null,
    ports: [],
    fields: [],
    initial: { protocol: 'proxy', port: 8080 },
    customEditor: false,
    failures: ['proxy.unreachable'],
    goal: null,
    sequence: null,
    topic: 'proxy',
  },
  {
    id: 'mail',
    label: 'ui.service.mail',
    roleName: 'ui.node.role.mail',
    icon: 'icon/svc_mail',
    ports: [
      { name: 'smtp', port: 25, label: 'ui.fw.service.smtp' },
      { name: 'imap', port: 143, label: 'ui.fw.service.imap' },
    ],
    fields: [{ key: 'domain', label: 'ui.service.mailDomain' }],
    initial: null,
    customEditor: false,
    failures: ['mail.no_server', 'mail.no_mx', 'mail.relay_failed', 'mail.unknown_domain'],
    goal: 'mail',
    sequence: 'mail',
    topic: 'mail',
  },
  {
    id: 'nas',
    label: 'ui.service.nas',
    roleName: 'ui.node.role.nas',
    icon: 'icon/svc_nas',
    ports: [{ name: 'smb', port: 445, label: 'ui.fw.service.smb' }],
    fields: [],
    initial: { protocol: 'nas' },
    customEditor: false,
    failures: [],
    goal: 'nas',
    sequence: null,
    topic: null,
  },
];

export const services = new Registry<ServiceDef>('サービス');
for (const d of DEFS) services.register(d);
services.freeze();

export const serviceDef = (id: Service['protocol']): ServiceDef => services.get(id);

// 入切で起動するときの初期の形。初期の形を持たないサービスは例外
export const initialService = (id: Service['protocol']): Service => {
  const initial = serviceDef(id).initial;
  if (initial === null) throw new Error(`入切で起動できないサービス: ${id}`);
  return initial;
};

// 口の名前を受け持つサービス。どのサービスも受け持たなければ例外
export const serviceOfPort = (name: PortName): ServiceDef => {
  const def = services.all().find((s) => s.ports.some((p) => p.name === name));
  if (def === undefined) throw new Error(`口を受け持つサービスがない: ${name}`);
  return def;
};

// 口の番号
export const servicePort = (name: PortName): number => serviceOfPort(name).ports.find((p) => p.name === name)!.port;

// ファイアウォールの規則で選べる口（登録の順）
export const firewallPorts = (): readonly ServicePort[] => services.all().flatMap((s) => s.ports);
