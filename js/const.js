// Справочники прототипа. Годы — целые, до н.э. отрицательные, нулевого года нет.

export const TYPES = [
  { id: 'hillfort',   name: 'Городище',                    legend: 'Городище',            color: '--type-hillfort' },
  { id: 'barrow',     name: 'Курган / курганный могильник', legend: 'Курганы',             color: '--type-barrow' },
  { id: 'settlement', name: 'Селище',                      legend: 'Селище',              color: '--type-settlement' },
  { id: 'camp',       name: 'Стоянка',                     legend: 'Стоянка',             color: '--type-camp' },
  { id: 'cemetery',   name: 'Грунтовый могильник',         legend: 'Грунтовый могильник', color: '--type-cemetery' },
  { id: 'stray_find', name: 'Случайная находка',           legend: 'Случайная находка',   color: '--type-stray', hollow: true },
];
export const TYPE = Object.fromEntries(TYPES.map(t => [t.id, t]));

export const EPOCHS = [
  { id: 'stone', name: 'Каменный век', from: -10000, to: -2001, children: [
    { id: 'paleolithic', name: 'Палеолит', from: -10000, to: -9001 },
    { id: 'mesolithic',  name: 'Мезолит',  from: -9000,  to: -5001 },
    { id: 'neolithic',   name: 'Неолит',   from: -5000,  to: -2001 },
  ] },
  { id: 'bronze',         name: 'Бронзовый век',          from: -2000, to: -801 },
  { id: 'early_iron',     name: 'Ранний железный век',    from: -800,  to: 500 },
  { id: 'early_medieval', name: 'Раннее средневековье',   from: 501,   to: 1000 },
  { id: 'medieval',       name: 'Средневековье',          from: 1001,  to: 1500 },
  { id: 'modern',         name: 'Новое время',            from: 1501,  to: 1800 },
];
export const EPOCH_FLAT = EPOCHS.flatMap(e => [e, ...(e.children || [])]);
export const EPOCH = Object.fromEntries(EPOCH_FLAT.map(e => [e.id, e]));
// подписи над таймлайном (в один ряд)
export const TIMELINE_EPOCHS = [
  { id: 'paleolithic', label: 'Палеолит / мезолит', from: -10000, to: -5001, select: ['paleolithic', 'mesolithic'] },
  { id: 'neolithic', label: 'Неолит', from: -5000, to: -2001, select: ['neolithic'] },
  { id: 'bronze', label: 'Бронзовый век', from: -2000, to: -801, select: ['bronze'] },
  { id: 'early_iron', label: 'Ранний железный век', from: -800, to: 500, select: ['early_iron'] },
  { id: 'early_medieval', label: 'Раннее ср.', from: 501, to: 1000, select: ['early_medieval'] },
  { id: 'medieval', label: 'Средневековье', from: 1001, to: 1500, select: ['medieval'] },
  { id: 'modern', label: 'Новое время', from: 1501, to: 1800, select: ['modern'] },
];

export const SCALE = [[-10000, 0], [-5000, 0.12], [-2000, 0.25], [-1000, 0.36], [0, 0.5], [500, 0.62], [1000, 0.75], [1500, 0.9], [1800, 1]];
export const YEAR_MIN = -10000;
export const YEAR_MAX = 1800;

export const FIND_CATS = [
  { id: 'ceramics', name: 'Керамика' }, { id: 'coins', name: 'Монеты' }, { id: 'weapons', name: 'Оружие' },
  { id: 'jewelry', name: 'Украшения' }, { id: 'tools', name: 'Орудия труда' }, { id: 'flint', name: 'Кремень' },
  { id: 'glass', name: 'Стекло' }, { id: 'osteology', name: 'Остеология' }, { id: 'household', name: 'Предметы быта' },
];
export const FIND_CAT = Object.fromEntries(FIND_CATS.map(c => [c.id, c]));

export const ACCURACY = [
  { id: 'exact', name: 'Точные (до 50 м)', badge: 'точные', radius: 15 },
  { id: 'approx', name: 'Примерные (до 1 км)', badge: 'примерные', radius: 250 },
  { id: 'settlement', name: 'До населённого пункта', badge: 'до нас. пункта', radius: 1500 },
  { id: 'none', name: 'Без координат (не на карте)', badge: 'нет координат', radius: 0 },
];
export const ACC = Object.fromEntries(ACCURACY.map(a => [a.id, a]));

export const EDIT_REASONS = [
  'Полевая GPS-съёмка',
  'Привязка по плану из публикации',
  'Сверка со спутниковым снимком',
  'Сообщение коллеги',
];

export const OBLAST_ORDER = ['Брестская обл.', 'Витебская обл.', 'Гомельская обл.', 'Гродненская обл.', 'Минская обл.', 'Могилёвская обл.'];
export const BELARUS_CENTER = [53.7, 27.95];
export const BELARUS_BOUNDS = [[51.25, 23.17], [56.18, 32.78]];
