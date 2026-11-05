import { describe, expect, it } from 'vitest';
import { clampCamera, fitCamera, fitZoom, panCamera, resizeCamera, stepZoom, zoomCamera, type Camera } from './camera';

// 16×12 マス、1マス 32 px のマップ（512×384）
const MAP = { w: 512, h: 384 };
const VIEW = { w: 1000, h: 700 };

describe('fitZoom（画面に収まる最大の整数倍。1〜4倍）', () => {
  it('画面に収まる最大の整数倍にする', () => {
    expect(fitZoom(MAP, { w: 1100, h: 800 })).toBe(2);
    expect(fitZoom(MAP, { w: 1000, h: 700 })).toBe(1);
    expect(fitZoom({ w: 100, h: 100 }, { w: 1000, h: 1000 })).toBe(4);
  });

  it('収まらないときは 1 倍（4倍を超えない）', () => {
    expect(fitZoom(MAP, { w: 300, h: 200 })).toBe(1);
    expect(fitZoom({ w: 10, h: 10 }, { w: 2000, h: 2000 })).toBe(4);
  });
});

describe('stepZoom（段階の移動）', () => {
  it('1〜4倍の段階を1つずつ進む', () => {
    expect(stepZoom(1, 1)).toBe(2);
    expect(stepZoom(3, 1)).toBe(4);
    expect(stepZoom(2, -1)).toBe(1);
  });

  it('端では変わらない', () => {
    expect(stepZoom(4, 1)).toBe(4);
    expect(stepZoom(1, -1)).toBe(1);
  });
});

describe('fitCamera（全体）', () => {
  it('画面に収まる倍率で中央に置き、全体の状態にする', () => {
    const cam = fitCamera(MAP, VIEW);
    expect(cam.zoom).toBe(1);
    expect(cam.fit).toBe(true);
    expect(cam.x).toBe(Math.round((1000 - 512) / 2));
    expect(cam.y).toBe(Math.round((700 - 384) / 2));
  });
});

describe('zoomCamera（カーソルの位置を中心に拡大する）', () => {
  it('カーソルの下にあったマップの点は、拡大の後も同じ画面の位置に残る', () => {
    const cam: Camera = { zoom: 1, x: 100, y: 50, fit: false };
    const anchor = { x: 300, y: 200 };
    // 拡大前にカーソルの下にあったマップの点（マップの座標）
    const mapPoint = { x: (anchor.x - cam.x) / cam.zoom, y: (anchor.y - cam.y) / cam.zoom };
    const next = zoomCamera(cam, MAP, VIEW, 2, anchor);
    expect(next.zoom).toBe(2);
    expect(next.fit).toBe(false);
    // 丸めの分（1 px 未満）を許す
    expect(Math.abs(next.x + mapPoint.x * 2 - anchor.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(next.y + mapPoint.y * 2 - anchor.y)).toBeLessThanOrEqual(1);
  });

  it('倍率が変わらないときは、そのまま返す', () => {
    const cam: Camera = { zoom: 4, x: 0, y: 0, fit: false };
    expect(zoomCamera(cam, MAP, VIEW, 4, { x: 10, y: 10 })).toBe(cam);
  });

  it('拡大・縮小の後も、移動の範囲に収まる', () => {
    const cam: Camera = { zoom: 1, x: 0, y: 0, fit: false };
    const next = zoomCamera(cam, MAP, VIEW, 4, { x: 0, y: 0 });
    const clamped = clampCamera(next, MAP, VIEW);
    expect(next).toEqual(clamped);
  });
});

describe('clampCamera（端より外へは画面の半分まで）', () => {
  it('マップの左端は、画面の中央より右へ行かない。右端は中央より左へ行かない', () => {
    const cam: Camera = { zoom: 1, x: 900, y: 0, fit: false };
    expect(clampCamera(cam, MAP, VIEW).x).toBe(500);
    const far: Camera = { zoom: 1, x: -2000, y: 0, fit: false };
    // マップの右端が画面の中央（500）に来る位置
    expect(clampCamera(far, MAP, VIEW).x).toBe(500 - 512);
  });

  it('画面より小さいマップも、中央を通る範囲の中でだけ動く', () => {
    const small = { w: 200, h: 100 };
    const cam: Camera = { zoom: 1, x: -1000, y: 0, fit: false };
    expect(clampCamera(cam, small, VIEW).x).toBe(500 - 200);
  });
});

describe('panCamera（移動）', () => {
  it('動かした分だけ位置を変え、全体の状態をやめる', () => {
    const cam = fitCamera(MAP, VIEW);
    const next = panCamera(cam, MAP, VIEW, 10, -5);
    expect(next.x).toBe(cam.x + 10);
    expect(next.y).toBe(cam.y - 5);
    expect(next.fit).toBe(false);
  });

  it('範囲の外へは動かない', () => {
    const cam: Camera = { zoom: 2, x: 0, y: 0, fit: false };
    const next = panCamera(cam, MAP, VIEW, 100000, 100000);
    expect(next.x).toBe(500);
    expect(next.y).toBe(350);
  });
});

describe('resizeCamera（画面の大きさが変わったとき）', () => {
  it('全体の状態なら、新しい画面に合わせて全体に直す', () => {
    const cam = fitCamera(MAP, VIEW);
    const next = resizeCamera(cam, MAP, VIEW, { w: 600, h: 400 });
    expect(next).toEqual(fitCamera(MAP, { w: 600, h: 400 }));
  });

  it('全体でなければ倍率を保ち、中央の位置を保ったまま範囲に収める', () => {
    const cam: Camera = { zoom: 2, x: -200, y: -100, fit: false };
    const next = resizeCamera(cam, MAP, VIEW, { w: 900, h: 600 });
    expect(next.zoom).toBe(2);
    expect(next.x).toBe(-200 + (900 - 1000) / 2);
    expect(next.y).toBe(-100 + (600 - 700) / 2);
    expect(next.fit).toBe(false);
  });

  it('画面が小さくなって範囲の外に出るときは、範囲の中へ戻す', () => {
    const cam: Camera = { zoom: 4, x: 0, y: 0, fit: false };
    const next = resizeCamera(cam, MAP, VIEW, { w: 300, h: 200 });
    expect(next.zoom).toBe(4);
    expect(next.x).toBeGreaterThanOrEqual(150 - 2048);
    expect(next.x).toBeLessThanOrEqual(150);
    expect(next.y).toBeGreaterThanOrEqual(100 - 1536);
    expect(next.y).toBeLessThanOrEqual(100);
  });
});
