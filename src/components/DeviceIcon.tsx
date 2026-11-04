// 機材の絵（種類ごとに形を変える。ゲーム画面の機器と同じ配色）
const ICON_COLOR: Record<string, string> = {
  pc: '#dfe3e8',
  server: '#a3acb8',
  l2_switch: '#4f7cc4',
  router: '#e0644f',
};
const OUTLINE = '#3b2a33';

export function DeviceIcon({ category, size = 48 }: { category: string; size?: number }) {
  const body = ICON_COLOR[category] ?? '#ffffff';
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" shapeRendering="crispEdges" aria-hidden="true">
      {category === 'pc' && (
        <>
          <rect x={8} y={6} width={32} height={24} fill={body} stroke={OUTLINE} strokeWidth={2} />
          <rect x={12} y={10} width={24} height={14} fill="#3b5f8a" />
          <rect x={21} y={30} width={6} height={5} fill={body} stroke={OUTLINE} strokeWidth={2} />
          <rect x={14} y={35} width={20} height={4} fill={body} stroke={OUTLINE} strokeWidth={2} />
        </>
      )}
      {category === 'server' && (
        <>
          <rect x={14} y={4} width={20} height={40} fill={body} stroke={OUTLINE} strokeWidth={2} />
          {[12, 22, 32].map((y) => (
            <rect key={y} x={18} y={y} width={12} height={3} fill="#5a6573" />
          ))}
          <rect x={30} y={38} width={2} height={2} fill="#62d26f" />
        </>
      )}
      {category === 'l2_switch' && (
        <>
          <rect x={4} y={16} width={40} height={20} fill={body} stroke={OUTLINE} strokeWidth={2} />
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <rect key={i} x={8 + i * 4.5} y={28} width={3} height={5} fill={OUTLINE} />
          ))}
        </>
      )}
      {category === 'router' && (
        <>
          <line x1={14} y1={18} x2={14} y2={6} stroke={OUTLINE} strokeWidth={2} />
          <line x1={34} y1={18} x2={34} y2={6} stroke={OUTLINE} strokeWidth={2} />
          <rect x={6} y={18} width={36} height={20} fill={body} stroke={OUTLINE} strokeWidth={2} />
          <rect x={10} y={30} width={4} height={4} fill="#62d26f" />
        </>
      )}
    </svg>
  );
}
