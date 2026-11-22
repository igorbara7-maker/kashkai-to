'use strict';
// Єдиний довідник вузлів. Кожен вузол має постійний ключ (key): пункт регламенту й запчастина
// прив'язуються до ключа (поле nodes: ['oil', …]), а не до слів у назві. Перейменували пункт —
// зв'язок не губиться. Нового вузла досить додати в LIST.
//   key   — постійний, не міняти й не використовувати повторно
//   group — вузол-розділ журналу (ремонти без інтервалу)
//   cat   — категорія позиції документа, що однозначно вказує на цей вузол (див. M.CATS)
//   re    — як упізнати вузол за назвою ЛИШЕ коли запис ще не має ключів
//           (одноразово: міграція старих даних і новий пункт, який власник щойно назвав)
const Nodes = (() => {
  const LIST = [
    { key: 'oil', cat: 'Олива двигуна і фільтр', re: /олива двигуна|моторн\S* олив/i },
    { key: 'air', re: /повітрян\S* фільтр|фільтр повітр/i },
    { key: 'cabin', re: /фільтр салону|салонн\S* фільтр/i },
    { key: 'plugs', cat: 'Свічки запалювання', re: /свічк/i },
    { key: 'brakefluid', re: /гальмівн\S* рідин/i },
    { key: 'coolant', cat: 'Антифриз', re: /антифриз|охолоджувальн\S* рідин/i },
    { key: 'belt', re: /(ремінь|ремені)(?! безпек)/i },
    { key: 'rollers', re: /ролик/i },
    { key: 'chain', re: /ланцюг/i },
    { key: 'mkpp', cat: 'Олива МКПП', re: /мкпп|кпп|коробк/i },
    { key: 'brakes', re: /^гальма/i },
    { key: 'chassis', re: /^ходова/i },
    { key: 'align', re: /розвал|сходжен/i },
    { key: 'cooling', re: /система охолодж/i },
    { key: 'fuel', re: /паливн/i },
    { key: 'locks', re: /замки|петлі/i },
    { key: 'padsF', re: /колодки.*передн/i },
    { key: 'padsR', re: /колодки.*задн/i },
    { key: 'valves', re: /зазор\S* клапан|клапан\S* зазор/i },
    { key: 'booster', re: /підсилювач\S* гальм|вакуумн\S* шланг/i },
    { key: 'pedals', re: /педал|стоянков\S* гальм|ручн\S* гальм/i },
    { key: 'seatbelts', re: /ремін\S* безпек|ремен\S* безпек/i },
    { key: 'battery', cat: 'Акумулятор', re: /акумулятор/i },
    { key: 'ac', cat: 'Кондиціонер', re: /кондиціонер/i },
    { key: 'wipers', cat: 'Склоочисники', re: /склоочис|двірник/i },
    { key: 'tires', cat: 'Шини і диски', re: /^шини/i },
    { key: 'gEngine', group: true, cat: 'Ремонт двигуна', re: /ремонт:?\s*двигун/i },
    { key: 'gChassis', group: true, re: /ремонт:?\s*ходов/i },
    { key: 'gElec', group: true, cat: 'Електрика', re: /ремонт:?\s*електр/i },
    { key: 'gBody', group: true, cat: 'Кузов (ДТП)', re: /^кузов/i },
    { key: 'gAcc', group: true, cat: 'Аксесуари, доп. обладнання', re: /аксесуар/i },
    { key: 'gWarranty', group: true, cat: 'Гарантійна кампанія', re: /гарантійн/i },
    { key: 'gDiag', group: true, re: /^діагностик/i },
  ];
  const byKey = {};
  for (const n of LIST) byKey[n.key] = n;
  const byCat = {};
  for (const n of LIST) if (n.cat) byCat[n.cat] = n.key;

  // Ключі за назвою — лише для запису, у якого ще немає nodes. Вузол-розділ шукаємо серед розділів.
  const guess = (name, group) => LIST.filter(n => !!n.group === !!group && n.re.test(name || '')).map(n => n.key);
  // Ключі пункту регламенту: збережені; а якщо запис ще без них (щойно надійшов з іншого пристрою) — за назвою.
  const ofRule = r => Array.isArray(r.nodes) ? r.nodes : guess(r.name, r.group);
  const has = (r, key) => ofRule(r).includes(key);

  return { LIST, byKey, byCat, guess, ofRule, has };
})();
