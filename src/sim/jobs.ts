// 職種の定義（N104）。src/assets/data/jobs.json を読み込み時に検証する。今はコードの分岐はまだ置き換えていない（値の一致だけを確かめる）
import jobsJson from '../assets/data/jobs.json';
import { jobsFileSchema, type JobDef } from '../data/schema';

export const JOB_DEFS: JobDef[] = jobsFileSchema.parse(jobsJson).jobs;

// 職種の定義を引く。定義にない ID は、状態の誤りとして例外にする（R5）
export const jobOf = (id: string): JobDef => {
  const def = JOB_DEFS.find((j) => j.id === id);
  if (!def) throw new Error(`職種の定義がない: ${id}`);
  return def;
};
