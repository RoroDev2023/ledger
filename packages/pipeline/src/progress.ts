// [Rahim] Stage events (frames | rooms | surfaces | findings | diff) that apps/api streams over SSE.

export type Stage = 'frames' | 'rooms' | 'surfaces' | 'findings' | 'diff';

export type OnProgress = (stage: Stage, done: number, total: number) => void;
