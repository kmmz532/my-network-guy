// DNS の論点の命令。
import { getComponent } from '../../components';
import { lookupName } from '../../dns';
import { isArg } from '../../command/args';
import { changed, err, nameOf, out, shown } from '../../command/lines';
import type { CommandContext, CommandResult, CommandSpec } from '../../command/types';
import type { Tr } from '../../terminal';
import type { DnsRecord, DnsRecordType, DnsService, NetNode } from '../../types';

const RECORD_TYPES: readonly DnsRecordType[] = ['A', 'AAAA', 'CNAME', 'MX', 'NS', 'PTR'];

// ゾーンの名前（www.example.com のように点で区切れる）。ホスト名（対応表）より緩く、ラベルは英数字とハイフン
const DNS_NAME_RE = /^[A-Za-z0-9-]{1,63}(\.[A-Za-z0-9-]{1,63})*$/;
const isDnsName = (text: string): boolean => DNS_NAME_RE.test(text);

const recordTypeOf = (text: string): DnsRecordType | null => (RECORD_TYPES as readonly string[]).includes(text.toUpperCase()) ? (text.toUpperCase() as DnsRecordType) : null;

// 値の形は種類で決まる。A は IPアドレス、名前を返す種類（CNAME・MX・NS・PTR）は名前、AAAA は値を返すだけなので形を問わない
const valueFits = (type: DnsRecordType, value: string): boolean => {
  if (type === 'A') return isArg('ip', value);
  if (type === 'AAAA') return true;
  return isDnsName(value);
};

const valueText = (r: DnsRecord): string => (r.pref === undefined ? r.value : `${r.pref} ${r.value}`);

// 機器の名前（ISP の仮想の機器のように一覧にない uid は、そのまま出す）
const labelOf = (ctx: CommandContext, uid: string): string => {
  const node = ctx.nodes.find((n) => n.uid === uid);
  return node ? nameOf(ctx, node) : uid;
};

const dnsServiceOf = (node: NetNode): DnsService | undefined => node.services.find((s): s is DnsService => s.protocol === 'dns');

// 名前を引く。経路（機器の列と、再帰・反復の別）を先に出し、答えの記録か失敗の理由を続ける
const nslookup = (name: string, type: DnsRecordType, ctx: CommandContext, tr: Tr): CommandResult => {
  if (!isDnsName(name)) return shown([err(tr('ui.terminal.dnsBadName'))]);
  if (!getComponent(ctx.node, 'resolver')?.nameServer) return shown([err(tr('ui.terminal.nslookupNoServer'))]);
  const r = lookupName(ctx.node, name, type, { nodes: ctx.nodes, links: ctx.links }, ctx.data);
  const steps = r.steps.map((s) =>
    out(tr('ui.terminal.nslookupStep', { from: labelOf(ctx, s.from), to: labelOf(ctx, s.to), mode: tr(s.mode === 'recursive' ? 'ui.terminal.dnsRecursive' : 'ui.terminal.dnsIterative') })),
  );
  if (!r.ok) return shown([...steps, err(tr(r.reason === 'dns.unreachable' ? 'ui.terminal.nslookupUnreachable' : 'ui.terminal.nslookupNotFound'))]);
  return shown([...steps, ...r.records.map((rec) => out(tr('ui.terminal.zoneLine', { name: rec.name, type: rec.type, value: valueText(rec) })))]);
};

// 記録を入れる（種類と値の形を確かめてから）。読み取り専用の拒否は、形の検査より先
const recordChange = (typeText: string, name: string, value: string, pref: number | null, ctx: CommandContext, tr: Tr): CommandResult => {
  if (ctx.readOnly) return shown([err(tr('ui.terminal.readOnly'))]);
  const type = recordTypeOf(typeText);
  if (type === null) return shown([err(tr('ui.terminal.dnsBadType'))]);
  if (!isDnsName(name)) return shown([err(tr('ui.terminal.dnsBadName'))]);
  if (!valueFits(type, value)) return shown([err(tr('ui.terminal.dnsBadValue'))]);
  const record: DnsRecord = { type, name, value, ...(pref === null ? {} : { pref }) };
  return changed(ctx, tr, { kind: 'dnsRecord', record });
};

export const commands: readonly CommandSpec[] = [
  {
    id: 'dns.showHosts',
    modes: ['exec'],
    tokens: [{ word: 'show' }, { word: 'hosts' }],
    help: 'ui.cmd.dns.showHosts',
    writes: false,
    topic: 'dns',
    run: (_args, { node }, tr) => {
      const hosts = (getComponent(node, 'resolver')?.hosts ?? []).map((h) => out(tr('ui.terminal.hostLine', { name: h.name, ip: h.ip })));
      const zone = (dnsServiceOf(node)?.zone ?? []).map((r) => out(tr('ui.terminal.zoneLine', { name: r.name, type: r.type, value: valueText(r) })));
      const lines = [...hosts, ...zone];
      return shown(lines.length > 0 ? lines : [out(tr('ui.terminal.noHosts'))]);
    },
  },
  {
    id: 'dns.ipHost',
    modes: ['exec', 'config'],
    tokens: [{ word: 'ip' }, { word: 'host' }, { arg: 'hostname', name: 'name' }, { arg: 'ip', name: 'ip' }],
    help: 'ui.cmd.dns.ipHost',
    writes: true,
    topic: 'dns',
    run: (args, ctx, tr) => changed(ctx, tr, { kind: 'host', name: args.name, ip: args.ip }),
  },
  {
    id: 'dns.noIpHost',
    modes: ['exec', 'config'],
    tokens: [{ word: 'no' }, { word: 'ip' }, { word: 'host' }, { arg: 'hostname', name: 'name' }],
    help: 'ui.cmd.dns.noIpHost',
    writes: true,
    topic: 'dns',
    run: (args, ctx, tr) => changed(ctx, tr, { kind: 'removeHost', name: args.name }),
  },
  {
    id: 'dns.ipNameServer',
    modes: ['exec', 'config'],
    tokens: [{ word: 'ip' }, { word: 'name-server' }, { arg: 'ip', name: 'ip' }],
    help: 'ui.cmd.dns.ipNameServer',
    writes: true,
    topic: 'dns',
    run: (args, ctx, tr) => changed(ctx, tr, { kind: 'nameServer', ip: args.ip }),
  },
  {
    id: 'dns.noIpNameServer',
    modes: ['exec', 'config'],
    tokens: [{ word: 'no' }, { word: 'ip' }, { word: 'name-server' }],
    help: 'ui.cmd.dns.noIpNameServer',
    writes: true,
    topic: 'dns',
    run: (_args, ctx, tr) => changed(ctx, tr, { kind: 'nameServer', ip: null }),
  },
  {
    id: 'dns.ipDnsServer',
    modes: ['exec', 'config'],
    tokens: [{ word: 'ip' }, { word: 'dns' }, { word: 'server' }],
    help: 'ui.cmd.dns.ipDnsServer',
    writes: true,
    topic: 'dns',
    run: (_args, ctx, tr) => changed(ctx, tr, { kind: 'dnsRole', on: true, role: 'auth' }),
  },
  {
    id: 'dns.ipDnsServerCache',
    modes: ['exec', 'config'],
    tokens: [{ word: 'ip' }, { word: 'dns' }, { word: 'server' }, { word: 'cache' }],
    help: 'ui.cmd.dns.ipDnsServerCache',
    writes: true,
    topic: 'dns',
    run: (_args, ctx, tr) => changed(ctx, tr, { kind: 'dnsRole', on: true, role: 'cache' }),
  },
  {
    id: 'dns.noIpDnsServer',
    modes: ['exec', 'config'],
    tokens: [{ word: 'no' }, { word: 'ip' }, { word: 'dns' }, { word: 'server' }],
    help: 'ui.cmd.dns.noIpDnsServer',
    writes: true,
    topic: 'dns',
    run: (_args, ctx, tr) => changed(ctx, tr, { kind: 'dnsRole', on: false }),
  },
  {
    id: 'dns.ipDnsForwarder',
    modes: ['exec', 'config'],
    tokens: [{ word: 'ip' }, { word: 'dns' }, { word: 'forwarder' }, { arg: 'ip', name: 'ip' }],
    help: 'ui.cmd.dns.ipDnsForwarder',
    writes: true,
    topic: 'dns',
    run: (args, ctx, tr) => changed(ctx, tr, { kind: 'dnsForwarder', ip: args.ip }),
  },
  {
    id: 'dns.noIpDnsForwarder',
    modes: ['exec', 'config'],
    tokens: [{ word: 'no' }, { word: 'ip' }, { word: 'dns' }, { word: 'forwarder' }],
    help: 'ui.cmd.dns.noIpDnsForwarder',
    writes: true,
    topic: 'dns',
    run: (_args, ctx, tr) => changed(ctx, tr, { kind: 'dnsForwarder', ip: null }),
  },
  {
    id: 'dns.ipDnsRecord',
    modes: ['exec', 'config'],
    tokens: [{ word: 'ip' }, { word: 'dns' }, { word: 'record' }, { arg: 'word', name: 'type' }, { arg: 'word', name: 'name' }, { arg: 'word', name: 'value' }],
    help: 'ui.cmd.dns.ipDnsRecord',
    writes: true,
    topic: 'dns',
    run: (args, ctx, tr) => recordChange(args.type, args.name, args.value, null, ctx, tr),
  },
  {
    id: 'dns.ipDnsRecordPref',
    modes: ['exec', 'config'],
    tokens: [
      { word: 'ip' }, { word: 'dns' }, { word: 'record' }, { arg: 'word', name: 'type' }, { arg: 'word', name: 'name' }, { arg: 'word', name: 'value' }, { arg: 'number', name: 'pref' },
    ],
    help: 'ui.cmd.dns.ipDnsRecordPref',
    writes: true,
    topic: 'dns',
    run: (args, ctx, tr) => recordChange(args.type, args.name, args.value, Number(args.pref), ctx, tr),
  },
  {
    id: 'dns.noIpDnsRecord',
    modes: ['exec', 'config'],
    tokens: [{ word: 'no' }, { word: 'ip' }, { word: 'dns' }, { word: 'record' }, { arg: 'word', name: 'type' }, { arg: 'word', name: 'name' }],
    help: 'ui.cmd.dns.noIpDnsRecord',
    writes: true,
    topic: 'dns',
    run: (args, ctx, tr) => {
      if (ctx.readOnly) return shown([err(tr('ui.terminal.readOnly'))]);
      const type = recordTypeOf(args.type);
      if (type === null) return shown([err(tr('ui.terminal.dnsBadType'))]);
      if (!isDnsName(args.name)) return shown([err(tr('ui.terminal.dnsBadName'))]);
      return changed(ctx, tr, { kind: 'removeDnsRecord', type, name: args.name });
    },
  },
  {
    id: 'dns.nslookup',
    modes: ['exec'],
    tokens: [{ word: 'nslookup' }, { arg: 'word', name: 'name' }],
    help: 'ui.cmd.dns.nslookup',
    writes: false,
    topic: 'dns',
    run: (args, ctx, tr) => nslookup(args.name, 'A', ctx, tr),
  },
  {
    id: 'dns.nslookupType',
    modes: ['exec'],
    tokens: [{ word: 'nslookup' }, { arg: 'word', name: 'name' }, { arg: 'word', name: 'type' }],
    help: 'ui.cmd.dns.nslookupType',
    writes: false,
    topic: 'dns',
    run: (args, ctx, tr) => {
      const type = recordTypeOf(args.type);
      if (type === null) return shown([err(tr('ui.terminal.dnsBadType'))]);
      return nslookup(args.name, type, ctx, tr);
    },
  },
];
