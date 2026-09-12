# NOVA Shorts Growth Engine — proxy-модель алгоритма YouTube

Важно: точный алгоритм YouTube закрыт и постоянно меняется. Эта модель НЕ утверждает, что воспроизводит внутренний алгоритм YouTube. Она переводит официально доступные сигналы в практический score для принятия решений.

## Официальные сигналы Shorts
YouTube указывает, что при ранжировании Shorts учитывает, среди прочего:
- выбрал ли зритель смотреть Short или свайпнул;
- среднюю длительность просмотра;
- средний процент просмотра;
- лайки;
- сигналы удовлетворённости после просмотра;
- интерес к теме;
- конкуренцию;
- сезонность.

## 1. PRE-PUBLISH SCORE — стоит ли вообще делать тему? (100)
- Topic demand / устойчивый спрос: 0–25
- Hook potential за первые 2 сек: 0–20
- Story/payoff potential: 0–15
- Content gap / конкурентный разрыв: 0–15
- Series/subscription potential: 0–10
- Originality/monetization safety: 0–15

Правило:
- <60: пропустить
- 60–69: только эксперимент
- 70–79: можно публиковать
- 80–89: высокий приоритет
- 90+: немедленно делать лучший вариант

## 2. POST-PUBLISH PERFORMANCE SCORE — 100
Когда есть данные ролика:
- Chose to view / viewed vs swiped away: 30
- Avg % viewed: 25
- Avg view duration relative to duration: 15
- Subscriber conversion per 1,000 views: 15
- Likes/comments/shares proxy for satisfaction: 10
- Rewatch/loop proxy when avg % viewed >100%: 5

### Нормализация
Сравнивать НЕ с чужими каналами, а прежде всего:
1. с медианой последних 7 Shorts канала;
2. с медианой последних 28 дней;
3. с роликами той же рубрики.

### Decision rules
- Performance score >=85 и просмотры растут быстрее медианы → Part 2 в ближайший слот.
- 75–84 → сохранить формат и протестировать новый hook.
- 60–74 → оставить тему, но переписать начало/монтаж.
- <60 → не повторять тот же формат без существенного изменения.
- Два ролика одной темы подряд <60 → заморозить тему минимум на 7 дней.

## 3. Subscriber Velocity
Главная метрика для цели «быстро тысячи подписчиков»:

Subscriber Velocity = новые подписчики / просмотры * 1000

Сравнивать с медианой канала.
- >=2x медианы → серия обязательна
- 1.2–2x → сильная тема
- 0.8–1.2x → нейтрально
- <0.8x → просмотры могут быть пустыми для роста подписчиков

## 4. Trend Acceleration
Для темы перед публикацией:
- YouTube Studio Trends/Research: Audience interest
- Breakout videos
- Recent videos
- Content gaps for Shorts
- свежесть темы
- скорость появления новых роликов по теме

Trend Acceleration score:
- Very high audience interest + content gap = приоритет
- High interest + breakout videos = быстрый тест
- High competition без content gap = нужен уникальный угол
- Low interest = не делать только ради хэштега

## 5. Minecraft strategy
Minecraft тестируется как отдельная content pillar, а не как гарантированный рост.
Первые 7–10 дней:
- 3 Minecraft story Shorts
- 4 utility/trend Shorts

Сравнивать:
- viewed vs swiped away
- avg % viewed
- subscriber velocity
- views after 1h / 6h / 24h
- share/comment rate

Если Minecraft выигрывает по Performance Score и Subscriber Velocity → увеличить до 50–70% сетки.
Если даёт просмотры, но мало подписок → использовать как reach-format, а подписки добирать сериализацией/персонажами.
