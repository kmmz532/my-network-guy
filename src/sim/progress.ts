import { applyMoney } from './ledger';
import type { Staff } from '../data/schema';
import { engineWithWalls } from './walls';
import type { Offer } from '../contracts/template';
import { evaluateContract } from '../network/goals';
import { linkLength } from '../network/engine';
import { isOnShift } from './shift';
import { rate, rewardRateOf } from './rating';
import { DELEGATE_MIN_COUNT, DELEGATED_EXP_DIVISOR, DELEGATED_STAR_CAP, familiarKeyOf, missingFixed, positionsMatch, recordDelivery, type Blueprint } from './familiar';
import { dueDayOf, lateDaysOf, lateFactor } from './deadline';
import { bonusEnvOf, furnitureBonus, type BonusEnv } from './furniture';
import { gainExp, staffPower } from './staff';
import { blindDelegation } from './blindDelegate';
import { busyStaff, crewBlock } from './crew';
import { warningsOf } from '../network/query/warnings';
import { deliveryExpOf, levelOf } from './level';
import { BlindOutcome, BlindPlan, Core, Env, GoalCheck, Office, Outcome, Project, ReportFailure, TestOutcome, TestResult, Trace, connect, contractLinks, delegationReason, designIssues, stateOfProject, fail, fixedNodes, focusedOf, hubFor, isPcIn, keepFocus, projectCostOf, requireDesign, withProject } from './project';

// 増えた機器を型紙につなぐときのケーブル（一番安いもの）
const WIRE_CABLE = 'utp_cat5e';

// 型紙を依頼に写す（N70）。型紙の固定の機器は同じ位置にあること。今回の依頼で増えた固定の機器は、同じ種類で置き、近くのスイッチかルーターに配線する
const copyBlueprint = (core: Core, p: Project, bp: Blueprint, env: Env): Outcome => {
  const fixed = fixedNodes(p.contract);
  if (!positionsMatch(bp, fixed)) return fail('delegate.fit');
  const missing = missingFixed(bp, fixed);
  const numbers = [...bp.nodes.map((n) => n.uid), ...bp.links.map((l) => l.uid)].map((u) => Number(/(\d+)$/.exec(u)?.[1] ?? 0));
  const copied: Project = {
    ...p,
    nodes: [...bp.nodes, ...missing],
    links: [...bp.links],
    plans: { ...bp.plans },
    seq: Math.max(p.seq, ...numbers) + 1,
    // 固定の機器は、依頼の時点で置かれている（施工済みとして扱う）。型紙の配線と増えた配線は、施工が必要
    built: { nodes: fixed.map((n) => n.uid), links: [] },
    testedOk: false,
  };
  let next = withProject(core, copied);
  for (const m of missing) {
    const current = next.active.find((x) => x.id === p.id);
    if (!current) return fail('none');
    const hub = hubFor(current.nodes, current.links, m);
    if (!hub) return fail('delegate.fit');
    const wired = connect(next, m.uid, hub.uid, WIRE_CABLE, env, 'focus');
    if (!wired.ok) return wired;
    next = wired.core;
  }
  return { ok: true, core: next };
};

// 設計中の案件に型紙を写す（「型紙を使う」）。同じ依頼の型紙が今の機器の置き場所に合うときだけ。写したあとは、テストをやり直す（N70）
export const applyBlueprint = (core: Core, env: Env): Outcome => {
  const p = requireDesign(core);
  if (typeof p === 'string') return fail(p);
  if (p.contract.inhouse) return fail('inhouse');
  const bp = core.familiarity.blueprints[familiarKeyOf(p.kind, p.baseId, p.contract.map)];
  if (!bp) return fail('delegate.blueprint');
  return copyBlueprint(core, p, bp.design, env);
};

export const acceptDelegated = (core: Core, offerId: string, slots: number, crew: string[], env: Env): Outcome => {
  const offer = core.offers.find((o) => o.id === offerId);
  if (!offer) return fail('none');
  const reason = delegationReason(core.familiarity, offer);
  if (reason) return fail(reason);
  const accepted = accept(core, offerId, slots, crew);
  if (!accepted.ok) return accepted;
  const bp = core.familiarity.blueprints[familiarKeyOf(offer.kind, offer.baseId, offer.contract.map)].design;
  const p = accepted.core.active.find((x) => x.id === offerId);
  if (!p) return fail('none');
  const copiedOut = copyBlueprint(accepted.core, { ...p, delegated: true }, bp, env);
  if (!copiedOut.ok) return copiedOut;
  const copied = copiedOut.core.active.find((x) => x.id === offerId);
  if (!copied) return fail('none');
  // 写した設計がテストを通らなければ、受注しない（この場合は状態を変えない）
  if (!judge(copied, env).passed) return fail('delegate.test');
  return keepFocus(core, requestBuild(withProject(copiedOut.core, { ...copied, testedOk: true }), env));
};

// 案件を外す（納品・取り消し）。外した案件が対象だったら、自社オフィスに戻す（別の案件へ勝手に移らない・N111）
const removeProject = (core: Core, id: string): Pick<Core, 'active' | 'focus'> => {
  const active = core.active.filter((p) => p.id !== id);
  return { active, focus: core.focus === id ? null : core.focus };
};

// 依頼を受注する。受注できるのは案件の枠（slots）の数まで。受注した案件を設計の対象にする。
// 自社案件は自社オフィスを引き継ぐため、同時に1件まで
export const accept = (core: Core, offerId: string, slots: number, crew: string[]): Outcome => {
  if (core.active.length >= slots) return fail('slots');
  const offer = core.offers.find((o) => o.id === offerId);
  if (!offer) return fail('none');
  // 担当は1人以上。ほかの案件の担当・研修中の社員は選べない
  if (crew.length === 0) return fail('crew');
  // 担当の判定は crewBlock だけを使う（内勤・研修・退職の予定・ほかの案件の担当を含む・N117）
  const free = (uid: string) => {
    const member = core.staff.find((s) => s.uid === uid);
    return member !== undefined && crewBlock(core, member) === null;
  };
  if (!crew.every(free)) return fail('crew');
  const inhouse = offer.contract.inhouse;
  if (inhouse && core.active.some((p) => p.contract.inhouse)) return fail('busy');
  const office = core.office;
  // 自社案件は、自社オフィスの機器と配線を引き継いで始める
  const fixed = fixedNodes(offer.contract).filter((n) => !inhouse || !office.nodes.some((o) => o.uid === n.uid));
  const nodes = inhouse ? [...office.nodes, ...fixed] : fixed;
  const links = inhouse ? [...office.links] : contractLinks(offer.contract);
  const project: Project = {
    id: offer.id,
    kind: offer.kind,
    baseId: offer.baseId,
    params: offer.params,
    contract: offer.contract,
    nodes,
    links,
    seq: inhouse ? office.seq : links.length,
    cost: 0,
    rework: 0,
    // 既設の機器は施工済みとして扱う
    built: { nodes: nodes.map((n) => n.uid), links: links.map((l) => l.uid) },
    inherited: inhouse ? office.nodes.map((n) => n.uid) : [],
    inheritedLinks: inhouse ? office.links.map((l) => l.uid) : [],
    phase: 'design',
    progress: 0,
    total: 0,
    testedOk: false,
    due: dueDayOf(core.clock.minute, offer.contract.deadlineDays),
    crew,
    // 自社案件は、自社オフィスのセグメントの設定を引き継ぐ
    plans: inhouse ? { ...office.plans } : {},
  };
  return {
    ok: true,
    core: {
      ...core,
      offers: core.offers.filter((o) => o.id !== offerId),
      active: [...core.active, project],
      focus: project.id,
    },
  };
};

// 施工を依頼する。施工時間は、まだ施工していない機器と配線の分だけかかる。テストに合格していなければ依頼できない（untested）。
export const requestBuild = (core: Core, env: Env): Outcome => {
  const p = requireDesign(core);
  if (typeof p === 'string') return fail(p);
  if (!p.testedOk) return fail('untested');
  const newNodes = p.nodes.filter((n) => !p.built.nodes.includes(n.uid));
  const newLinks = p.links.filter((l) => !p.built.links.includes(l.uid));
  const total =
    newNodes.length * env.balance.build.minutesPerDevice +
    newLinks.reduce((sum, l) => sum + linkLength(l.path) * env.balance.build.minutesPerCableTile, 0);
  return { ok: true, core: withProject(core, { ...p, phase: 'build', progress: 0, total }) };
};

// 施工を1Tick分進める。勤務時間内のみ、担当の社員が並行して作業する。施工中の案件をすべて進め、終わった案件は検収する。
// 検収の結果が出たら止める（残りの案件は次のTickで進める）
// juniorRate は人事の効果（新人の施工の経験値の倍率。既定は1）
export const advanceBuild = (core: Core, env: Env, hour: number, juniorRate = 1): Outcome => {
  // 施工は、その時刻に勤務中の担当の社員だけが進める（日勤と夜勤は区分ごと。N48）
  const minute = hour * 60;
  const onShiftNow = (s: Staff) => isOnShift(minute, s.shift, env.balance);
  const bonusEnv: BonusEnv = bonusEnvOf({ staff: core.staff, office: core.office }, env);
  const crewOf = (p: Project) => core.staff.filter((s) => p.crew.includes(s.uid));
  // 施工中の案件の担当は、勤務中に1ゲーム時間ぶんの経験値を得る（着席の社員は家具の補正を受ける）
  let state: Core = core;
  const building = busyStaff({ active: core.active.filter((p) => p.phase === 'build') });
  if (building.size > 0) {
    const hours = env.balance.time.gameMinutesPerTick / 60;
    state = {
      ...core,
      staff: core.staff.map((s) =>
        building.has(s.uid) && onShiftNow(s)
          ? gainExp(
              s,
              hours * (1 + furnitureBonus(core.office, s.uid, bonusEnv).exp) * (s.level <= env.balance.backOffice.hr.juniorMaxLevel ? juniorRate : 1),
              env.balance.staff.expPerLevel,
            )
          : s,
      ),
    };
  }
  // 全案件の進みを反映してから検収する（1つの案件を検収しても、同じTickのほかの案件の進みを捨てない）
  let finished: string | null = null;
  for (const p of core.active) {
    if (p.phase !== 'build') continue;
    // 施工の進みは、担当の社員の施工力の合計に比例する。案件の向いている職種の社員は1.5倍
    const jobs = p.contract.jobs ?? [];
    const power = crewOf(p).filter(onShiftNow).reduce((sum, s) => sum + staffPower(s, jobs, core.office, bonusEnv), 0);
    let progress = p.progress;
    progress += env.balance.time.gameMinutesPerTick * power * (1 + core.effects.buildSpeed);
    if (progress < p.total) {
      state = withProject(state, { ...p, progress });
      continue;
    }
    const built = {
      nodes: p.nodes.map((n) => n.uid),
      links: p.links.map((l) => l.uid),
    };
    state = withProject(state, { ...p, progress, built });
    finished ??= p.id;
  }
  // 検収の結果が出たら止める（残りの施工を終えた案件は次のTickで検収する）。型紙なしで任せた依頼は、受注のときの結果で納品する
  if (finished !== null) {
    const done = state.active.find((x) => x.id === finished);
    if (done?.blind) return settleBlind(state, done, done.blind, env);
    return inspect(state, env, finished);
  }
  return { ok: true, core: state };
};

// 設計を判定する（テストと検収で同じ判定を使う）。達成条件ごとに、失敗した機器と理由をまとめる
const judge = (p: Project, env: Env) => {
  const engine = engineWithWalls(env.engine, env.mapOf?.(p.contract.map));
  const result = evaluateContract(p.contract, stateOfProject(p, { ...env, engine }));
  const traces: Trace[] = result.results.map((r) => {
    const goal = p.contract.goals.indexOf(r.goal);
    return { kind: r.kind, src: r.src, dst: r.dst, result: r.result, ...(goal >= 0 ? { goal } : {}) };
  });
  const goals: GoalCheck[] = p.contract.goals.map((goal) => {
    const rs = result.results.filter((r) => r.goal === goal);
    const seen = new Set<string>();
    const failures: GoalCheck['failures'] = [];
    for (const r of rs) {
      if (r.ok || !r.failure) continue;
      const key = `${r.failure.node}:${r.failure.reason}`;
      if (seen.has(key)) continue;
      seen.add(key);
      failures.push({ node: r.failure.node, reason: r.failure.reason });
    }
    return { ok: rs.length > 0 && rs.every((r) => r.ok), failures };
  });
  return { passed: result.passed, results: result.results, traces, goals };
};

// テストを押す。設計を判定し、合格なら施工を依頼できるようにする（testedOk）。時間も費用もかからない。何度でも押せる
export const testDesign = (core: Core, env: Env): TestOutcome => {
  const p = requireDesign(core);
  if (typeof p === 'string') return { ok: false, reason: p };
  const j = judge(p, env);
  const result: TestResult = { passed: j.passed, goals: j.goals, traces: j.traces, warnings: warningsOf(stateOfProject(p, env)) };
  return { ok: true, core: withProject(core, { ...p, testedOk: j.passed }), result };
};

export const delegateBlind = (core: Core, offerId: string, crew: string[], env: Env, rng: number, slots: number): BlindOutcome => {
  const offer = core.offers.find((o) => o.id === offerId);
  if (!offer) return { ok: false, reason: 'none' };
  const contract = offer.contract;
  if (contract.inhouse) return { ok: false, reason: 'inhouse' };
  const key = familiarKeyOf(offer.kind, offer.baseId, contract.map);
  if ((core.familiarity.counts[key] ?? 0) < DELEGATE_MIN_COUNT) return { ok: false, reason: 'delegate.count' };
  // 型紙が写せるなら、型紙で任せる（こちらは使わない）
  const bp = core.familiarity.blueprints[key];
  if (bp && positionsMatch(bp.design, fixedNodes(contract))) return { ok: false, reason: 'delegate.blueprint_fits' };
  // 担当・枠・内勤の判定は受注と同じ（accept）
  const accepted = accept(core, offerId, slots, crew);
  if (!accepted.ok) return { ok: false, reason: accepted.reason };
  const crewMembers = crew.map((uid) => core.staff.find((s) => s.uid === uid)) as Staff[];
  const bonusEnv: BonusEnv = bonusEnvOf({ staff: core.staff, office: core.office }, env);
  const jobs = contract.jobs ?? [];
  const power = crewMembers.reduce((sum, m) => sum + staffPower(m, jobs, core.office, bonusEnv), 0);
  const pcCount = contract.placed.filter((p) => isPcIn(env, p.device)).length;
  const match = jobs.length === 0 ? 1 : crewMembers.filter((m) => jobs.includes(m.job)).length / crewMembers.length;
  const result = blindDelegation(power, pcCount, match, env.balance, rng);
  const plan: BlindPlan = { stars: result.stars, costRatio: result.costRatio, rework: result.rework };
  // 施工の時間は、配置する機器の数で決める。進みは担当の社員の施工力に比例する（advanceBuild）
  const total = Math.max(1, contract.placed.length) * env.balance.delegate.blindMinutesPerDevice;
  const project = accepted.core.active.find((x) => x.id === offerId);
  if (!project) return { ok: false, reason: 'none' };
  const started: Project = { ...project, delegated: true, blind: plan, phase: 'build', progress: 0, total, testedOk: true };
  return { ok: true, core: { ...withProject(accepted.core, started), focus: core.focus }, rng: result.rng };
};

// 型紙なしで任せた依頼を納品する。費用は予算 × 費用の割合、報酬は★の倍率で決まる。経験値は半分。設計は地図に残さない
const settleBlind = (core: Core, p: Project, plan: BlindPlan, env: Env): Outcome => {
  const contract = p.contract;
  const { stars, costRatio, rework } = plan;
  const cost = Math.round(contract.budget * costRatio);
  const money = Math.round(contract.reward.money * rewardRateOf(stars, env.balance));
  const fullExp = deliveryExpOf(contract.unlockLevel, levelOf(core.companyExp, env.balance), rewardRateOf(stars, env.balance), env.balance);
  const expGain = Math.max(1, Math.floor(fullExp / DELEGATED_EXP_DIVISOR));
  let clock = applyMoney(core.clock, -cost, 'construction');
  clock = applyMoney(clock, money, 'reward');
  // 報酬の機器はインベントリに入る（型紙で任せた依頼と同じ）
  const owned = { ...core.owned };
  for (const r of contract.reward.devices ?? []) owned[r.device] = (owned[r.device] ?? 0) + r.count;
  return {
    ok: true,
    core: {
      ...core,
      ...removeProject(core, p.id),
      clock,
      owned,
      completed: p.kind === 'fixed' ? [...core.completed, p.baseId] : core.completed,
      deliveries: core.deliveries + 1,
      companyExp: core.companyExp + expGain,
      reputation: core.reputation + stars,
    },
    report: {
      passed: true,
      traces: [],
      failures: [],
      stars,
      money,
      cost,
      budget: contract.budget,
      rework,
      lateDays: 0,
      designIssues: 0,
      expGain,
      rewardDevices: contract.reward.devices ?? [],
      delegated: true,
    },
  };
};

// 検収: 達成条件を判定する。合格なら納品して報酬と評判を得る。不合格なら設計に戻す（テストの結果を画面に残す）。
export const inspect = (core: Core, env: Env, id: string): Outcome => {
  const p = core.active.find((x) => x.id === id);
  if (!p) return fail('none');
  const j = judge(p, env);
  const traces = j.traces;
  if (j.passed) {
    // 期日に遅れたら、遅れた日数に応じて報酬が減る。遅れた案件と設計の不備がある案件は、★は2が上限になる
    const lateDays = lateDaysOf(p.due, core.clock.minute);
    const issues = Object.keys(designIssues(p, env)).length;
    const cost = projectCostOf(p);
    const rawStars = rate(cost.total, p.contract.budget, p.rework, lateDays > 0, issues, env.balance);
    // 任せた依頼は★の上限が2（N70）
    const stars = (p.delegated ? Math.min(DELEGATED_STAR_CAP, rawStars) : rawStars) as typeof rawStars;
    // 報酬は、期日の割合と★ごとの倍率を掛けた額
    const money = Math.round(p.contract.reward.money * lateFactor(lateDays, env.balance) * rewardRateOf(stars, env.balance));
    // 会社の経験値は、現在のレベルの必要経験値に割合と★の倍率を掛けた量で増える（deliveryExpOf）。評判は得た★の数だけ増える（N55）
    const expGain = deliveryExpOf(p.contract.unlockLevel, levelOf(core.companyExp, env.balance), rewardRateOf(stars, env.balance), env.balance);
    // 任せた依頼は経験値を半分にする（N70）
    const companyExp = core.companyExp + (p.delegated ? Math.max(1, Math.floor(expGain / DELEGATED_EXP_DIVISOR)) : expGain);
    const reputation = core.reputation + stars;
    // 自社案件は、納品したネットワークを自社オフィスとして残し、効果を加える
    const office: Office = p.contract.inhouse
      ? { ...core.office, nodes: p.nodes, links: p.links, seq: p.seq, plans: p.plans }
      : core.office;
    const effects = { buildSpeed: core.effects.buildSpeed + (p.contract.effect?.buildSpeed ?? 0) };
    // 報酬の機器はインベントリに入る（自社案件の報酬）
    const owned = { ...core.owned };
    for (const r of p.contract.reward.devices ?? []) owned[r.device] = (owned[r.device] ?? 0) + r.count;
    return {
      ok: true,
      core: {
        ...core,
        ...removeProject(core, p.id),
        office,
        effects,
        owned,
        clock: applyMoney(core.clock, money, 'reward'),
        companyExp,
        reputation,
        completed: p.kind === 'fixed' ? [...core.completed, p.baseId] : core.completed,
        // なじみの依頼: ★2以上の納品を数え、設計を型紙として覚える（自社案件は対象外）（N70）
        familiarity: p.contract.inhouse ? core.familiarity : recordDelivery(core.familiarity, familiarKeyOf(p.kind, p.baseId, p.contract.map), stars, { nodes: p.nodes, links: p.links, plans: p.plans }),
        deliveries: core.deliveries + 1,
      },
      report: {
        passed: true,
        delivered: p,
        traces,
        stars,
        money,
        lateDays,
        cost: cost.total,
        costBreakdown: cost,
        rewardDevices: p.contract.reward.devices ?? [],
        delegated: p.delegated,
        budget: p.contract.budget,
        rework: p.rework,
        designIssues: issues,
        expGain: companyExp - core.companyExp,
        failures: [],
      },
    };
  }
  const failures: ReportFailure[] = j.results
    .filter((r) => !r.ok && r.failure)
    .map((r) => ({ reason: r.failure!.reason, node: r.failure!.node, goal: r.goal.type }));
  const next: Project = { ...p, rework: p.rework + 1, phase: 'design', progress: 0, total: 0, testedOk: false };
  return {
    ok: true,
    core: withProject(core, next),
    report: { passed: false, traces, failures, check: { projectId: p.id, goals: j.goals, warnings: warningsOf(stateOfProject(p, env)) } },
  };
};

// 受注中の案件を取り消す（施工前のみ）。配置した機器は在庫に戻す。
export const abandon = (core: Core): Outcome => {
  const p = focusedOf(core);
  if (!p) return fail('none');
  const inherited = new Set(p.inherited ?? []);
  const builtNew = p.built.nodes.filter((uid) => !inherited.has(uid));
  if (p.phase !== 'design' || builtNew.length > p.contract.placed.length) return fail('locked');
  const owned = { ...core.owned };
  for (const n of p.nodes) if (!n.locked && !inherited.has(n.uid)) owned[n.device] = (owned[n.device] ?? 0) + 1;
  // 固定案件は、やめても依頼の一覧に戻す（定型案件は今までどおり消える）
  const back = p.kind === 'fixed' && !core.offers.some((o) => o.baseId === p.baseId);
  const offers: Offer[] = back
    ? [...core.offers, { id: p.baseId, kind: 'fixed', baseId: p.baseId, params: p.params, contract: p.contract }]
    : core.offers;
  return { ok: true, core: { ...core, owned, offers, ...removeProject(core, p.id) } };
};
