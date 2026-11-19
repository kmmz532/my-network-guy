import { http } from '../engine/forward';
import { analyze } from '../engine/analyze';
import type { NetworkState } from '../engine/state';
import type { NetNode, PathResult } from '../types';
// サーバーが、各クライアントからの HTTP で見るアドレス（N146）。NAPT で送信元を書き換えた通信は外のアドレス、書き換えなければクライアントのアドレス。届かない通信は含めない

export interface SeenSource {
  client: string;
  seenIp: string;
}
// 届いた HTTP の送信元を、宛先から見たアドレスで返す。NAPT を通ればその外のアドレス、プロキシを通ればプロキシのアドレス、どちらでもなければ端末のアドレス。口にアドレスがなければ undefined
export const seenIpOf = (nodes: readonly NetNode[], client: string, result: PathResult): string | undefined => {
  if (result.nat) return result.nat.outsideIp;
  return nodes.find((n) => n.uid === (result.proxy?.uid ?? client))?.interfaces[0]?.ip;
};

export const seenSourcesOf = (state: NetworkState, serverUid: string, port: number, clientUids: readonly string[]): SeenSource[] =>
  clientUids.flatMap((client) => {
    const r = http(analyze(state.input, state.world), client, serverUid, port);
    if (!r.ok) return [];
    const ip = seenIpOf(state.input.nodes, client, r);
    return ip === undefined ? [] : [{ client, seenIp: ip }];
  });
