// ツールチップの箱。画面の座標（left・top）に固定して置き、操作を受けない。文字は UI の大きさの倍率を受け、箱の位置は倍率を受けない。
// 1 行目（name）は太字、続き（rest、なければ省く）は改行を保つ。visible が偽の間は測るためだけに置く。
import type { Ref } from 'react';
import './tokens.css';
import './ui.css';

interface Props {
  boxRef: Ref<HTMLDivElement>;
  left: number;
  top: number;
  visible: boolean;
  name: string;
  rest?: string;
}

export function TipBox({ boxRef, left, top, visible, name, rest }: Props) {
  return (
    <div ref={boxRef} className="ui-tip-box" style={{ left, top, visibility: visible ? 'visible' : 'hidden' }}>
      <div className="ui-tip-box__zoom">
        <div className="ui-tip-box__name">{name}</div>
        {rest !== undefined && <div>{rest}</div>}
      </div>
    </div>
  );
}
