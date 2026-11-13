import { http } from '../engine/forward';
import { analyze } from '../engine/analyze';
import type { NetworkState } from '../engine/state';
// サーバーが、各クライアントからの HTTP で見るアドレス（N146）。NAPT で送信元を書き換えた通信は外のアドレス、書き換えなければクライアントのアドレス。届かない通信は含めない

export interface SeenSource {
  client: string;
  seenIp: string;
}
export const seenSourcesOf = (state: NetworkState, serverUid: string, port: number, clientUids: readonly string[]): SeenSource[] =>
  clientUids.flatMap((client) => {
    const r = http(analyze(state.input, state.world), client, serverUid, port);
    if (!r.ok) return [];
    const ip = r.nat?.outsideIp ?? state.input.nodes.find((n) => n.uid === client)?.interfaces[0]?.ip;
    return ip === undefined ? [] : [{ client, seenIp: ip }];
  });
