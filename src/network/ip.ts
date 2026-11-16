// IPv4 アドレスの計算（文字列と整数の変換・サブネットの判定）
export const ipToInt = (ip: string): number =>
  ip.split('.').reduce((acc, octet) => ((acc << 8) + Number(octet)) >>> 0, 0);

const maskOf = (prefix: number): number => (prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0);

// IPアドレスのネットワークアドレス（a.b.c.d/nn の a.b.c.d の部分）
export const networkOf = (ip: string, prefix: number): string => {
  const n = (ipToInt(ip) & maskOf(prefix)) >>> 0;
  return [24, 16, 8, 0].map((s) => (n >>> s) & 255).join('.');
};

export const inSubnet = (ip: string, network: string, prefix: number): boolean =>
  ((ipToInt(ip) & maskOf(prefix)) >>> 0) === ((ipToInt(network) & maskOf(prefix)) >>> 0);

// プレフィックス長のワイルドカード（サブネットマスクの 0 と 1 を反対にした値。24 なら 0.0.0.255）
export const wildcardOf = (prefix: number): string => {
  const n = (~maskOf(prefix)) >>> 0;
  return [24, 16, 8, 0].map((s) => (n >>> s) & 255).join('.');
};

// ワイルドカードの 1 のビットを除いて、アドレスが prefix と一致するか（OSPF の network 文の照合）
export const inWildcard = (ip: string, prefix: string, wildcard: string): boolean => {
  const keep = ~ipToInt(wildcard) >>> 0;
  return ((ipToInt(ip) & keep) >>> 0) === ((ipToInt(prefix) & keep) >>> 0);
};

// プライベートアドレス（10/8・172.16/12・192.168/16）か
export const isPrivateIp = (ip: string): boolean => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
