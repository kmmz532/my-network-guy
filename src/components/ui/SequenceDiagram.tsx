// シーケンス図の絵。上に名前を並べ、機器ごとの縦の線を引き、1行1本の矢印（根元 from、先 targets）を上から順に描く。
// dashed は点線。failure があれば、矢印の先に × と理由を出し、行を失敗の色にする。大きさに合わせて、窓の中で縦横にスクロールする
import './tokens.css';
import './ui.css';

export interface SequenceDiagramRow {
  label: string;
  from: number;
  targets: number[];
  dashed: boolean;
  // 失敗の理由の文
  failure?: string;
}

const LANE_W = 130;
const ROW_H = 54;
const HEAD_H = 34;
const MARGIN_X = 70;
const ARROW = 7;

export function SequenceDiagram({ title, lanes, rows }: { title: string; lanes: string[]; rows: SequenceDiagramRow[] }) {
  const x = (i: number) => MARGIN_X + i * LANE_W;
  const width = MARGIN_X * 2 + Math.max(0, lanes.length - 1) * LANE_W;
  const height = HEAD_H + rows.length * ROW_H + 8;
  return (
    <div className="ui-sequence">
      <svg width={width} height={height} role="img" aria-label={title}>
        {lanes.map((name, i) => (
          <g key={i}>
            <text x={x(i)} y={16} textAnchor="middle" className="ui-sequence__name">{name}</text>
            <line x1={x(i)} y1={HEAD_H - 6} x2={x(i)} y2={height} className="ui-sequence__lane" />
          </g>
        ))}
        {rows.map((row, r) => {
          const y = HEAD_H + r * ROW_H + ROW_H * 0.65;
          const fx = x(row.from);
          const span = [fx, ...row.targets.map(x)];
          const mid = (Math.min(...span) + Math.max(...span)) / 2;
          const failed = row.failure !== undefined;
          return (
            <g key={r} className={failed ? 'ui-sequence__row ui-sequence__row--failed' : 'ui-sequence__row'}>
              <text x={mid} y={y - 6} textAnchor="middle" className="ui-sequence__text">{row.label}</text>
              {row.targets.map((ti) => {
                const tx = x(ti);
                const dir = tx >= fx ? 1 : -1;
                return (
                  <g key={ti}>
                    <line x1={fx} y1={y} x2={tx} y2={y} className={row.dashed ? 'ui-sequence__arrow ui-sequence__arrow--dashed' : 'ui-sequence__arrow'} />
                    {failed ? (
                      <text x={tx} y={y + 5} textAnchor="middle" className="ui-sequence__cross">×</text>
                    ) : (
                      <polygon points={`${tx},${y} ${tx - dir * ARROW},${y - 4} ${tx - dir * ARROW},${y + 4}`} className="ui-sequence__head" />
                    )}
                  </g>
                );
              })}
              {failed && <text x={x(row.targets[0])} y={y + 20} textAnchor="middle" className="ui-sequence__text">{row.failure}</text>}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
