(() => {
  'use strict';

  const VERSION = '26.1.0';
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  const stage = $('#stage');
  const appShell = $('.app-shell');
  const chatPanel = $('#chatPanel');
  const panelToggle = $('#panelToggle');
  const panelToggleText = $('#panelToggleText');
  const compassWidget = $('#compassWidget');
  const compassDial = $('#compassDial');
  const compassReadout = $('#compassReadout');
  const owner = $('#owner');
  const robot = $('#robot');
  const cat = $('#cat');
  const chat = $('#chat');
  const quickActions = $('#quickActions');
  const englishLesson = $('#englishLesson');
  const lessonProgress = $('#lessonProgress');
  const lessonWord = $('#lessonWord');
  const lessonPhonetic = $('#lessonPhonetic');
  const lessonTranslation = $('#lessonTranslation');
  const lessonExample = $('#lessonExample');
  const lessonListenBtn = $('#lessonListenBtn');
  const lessonQuizBtn = $('#lessonQuizBtn');
  const lessonNextBtn = $('#lessonNextBtn');
  const lessonCloseBtn = $('#lessonCloseBtn');
  const composer = $('#composer');
  const input = $('#messageInput');
  const micBtn = $('#micBtn');
  const sendBtn = $('#sendBtn');
  const ruBtn = $('#ruBtn');
  const enBtn = $('#enBtn');
  const statusRow = $('.status-row');
  const statusText = $('#statusText');
  const brainBtn = $('#brainBtn');
  const brainStateText = $('#brainStateText');
  const dragHint = $('#dragHint');
  const toast = $('#toast');
  const actionButtons = $$('.action-btn');
  const brain = window.NovaBrain || null;
  let brainThinking = false;
  let brainRequestId = 0;

  /*
   * Keep the app anchored while iPhone Safari expands/collapses its toolbars.
   * Height-only resize events must not rebuild the grid or move the characters.
   */
  const root = document.documentElement;
  let stableViewportHeight = 0;
  let stableViewportWidth = 0;
  let keyboardFrame = 0;

  function visibleViewportHeight() {
    return Math.round(window.visualViewport?.height || window.innerHeight || root.clientHeight);
  }

  function updateKeyboardLift() {
    cancelAnimationFrame(keyboardFrame);
    keyboardFrame = requestAnimationFrame(() => {
      const viewport = window.visualViewport;
      const inputFocused = document.activeElement === input;
      const visibleBottom = viewport ? Math.round(viewport.height + viewport.offsetTop) : stableViewportHeight;
      const covered = Math.max(0, stableViewportHeight - visibleBottom);
      const lift = inputFocused && covered > 120
        ? Math.min(covered, Math.round(stableViewportHeight * .58))
        : 0;
      root.style.setProperty('--keyboard-lift', `${lift}px`);
      root.classList.toggle('keyboard-open', lift > 0);
    });
  }

  function lockStableViewport(force = false) {
    const width = Math.round(window.innerWidth || root.clientWidth);
    if (!force && stableViewportWidth && Math.abs(width - stableViewportWidth) < 40) return false;
    stableViewportWidth = width;
    stableViewportHeight = visibleViewportHeight();
    root.style.setProperty('--app-height', `${stableViewportHeight}px`);
    root.classList.toggle('compact-height', stableViewportHeight <= 720);
    updateKeyboardLift();
    return true;
  }

  lockStableViewport(true);

  const copy = {
    ru: {
      'action.joke': 'Шутка',
      'action.spin': 'Крутись',
      'action.guitar': 'Гитара',
      'action.dance': 'Танцуй',
      'action.laugh': 'Смейся',
      'action.cat': 'Кошка',
      'action.english': 'Английский',
      'lesson.title': 'Учим английский',
      'lesson.listen': 'Слушать',
      'lesson.quiz': 'Проверка',
      'lesson.next': 'Дальше',
      'lesson.closeAria': 'Закрыть урок английского',
      'lesson.progress': '{current}/{total} • верно {score}',
      'lesson.start': 'Начинаем урок! Каждый день NOVA даёт 10 полезных слов и фраз. Нажми «Слушать», а потом «Проверка».',
      'lesson.repeat': 'Сегодняшний урок уже пройден. Давай повторим 10 слов ещё раз!',
      'lesson.quizPrompt': 'Скажи по-английски: «{translation}». Можно ответить голосом или написать.',
      'lesson.quizHint': 'Скажи это по-английски голосом или напиши ответ.',
      'lesson.answerPlaceholder': 'Скажи по-английски…',
      'lesson.correct': 'Правильно! {answer}.',
      'lesson.tryAgain': 'Почти. Попробуй ещё раз — NOVA слушает английский ответ.',
      'lesson.finished': 'Урок на сегодня пройден! Результат: {score} из {total}. Завтра NOVA даст 10 новых слов и фраз.',
      'lesson.closed': 'Урок закрыт. Чтобы вернуться, скажи: «Учим английский».',
      'composer.label': 'Сообщение для NOVA',
      'composer.placeholder': 'Напиши или нажми микрофон…',
      'panel.collapse': 'Свернуть панель вниз',
      'panel.expand': 'Поднять панель вверх',
      'compass.tap': 'НАЖМИ',
      'compass.wait': 'ИЩУ…',
      'compass.ariaStart': 'Включить компас',
      'compass.ariaWaiting': 'Компас ожидает данные датчика',
      'compass.ariaHeading': 'Компас: {degrees} градусов, направление {direction}',
      'compass.zoomIn': 'Нажмите, чтобы увеличить',
      'compass.zoomOut': 'Нажмите, чтобы уменьшить',
      'compass.zoomed': 'Компас увеличен. Нажми ещё раз, чтобы уменьшить.',
      'compass.normal': 'Обычный размер. Нажми ещё раз, чтобы увеличить.',
      'compass.enabled': 'Компас включён и увеличен. Поверни телефон, и стрелка покажет север. Нажми ещё раз, чтобы уменьшить.',
      'compass.current': 'Направление: {degrees}°, {direction}.',
      'compass.denied': 'Разреши доступ к движению и ориентации, чтобы компас работал.',
      'compass.unsupported': 'На этом устройстве датчик компаса недоступен.',
      'compass.secure': 'Компас работает на опубликованном HTTPS‑сайте в Safari.',
      'compass.noSensor': 'Поверни телефон восьмёркой, чтобы откалибровать компас.',
      'drag.hint': '↔ Перетаскивай Тумсоева, NOVA и кошку',
      'status.ready': 'NOVA готова',
      'status.listening': 'Слушаю… говорите',
      'status.heard': 'Слышу: {text}',
      'status.thinking': 'Поняла. Отвечаю…',
      'status.searching': 'Ищу точный ответ…',
      'status.brainLoading': 'Загружаю бесплатный мозг… {progress}%',
      'status.brainThinking': 'Локальный мозг думает…',
      'status.speaking': 'NOVA говорит…',
      'status.music': 'Тумсоев и NOVA играют на гитаре…',
      'status.micOff': 'Микрофон выключен',
      'status.micDenied': 'Разрешите доступ к микрофону',
      'status.micUnsupported': 'Здесь голосовой ввод не поддерживается',
      'status.secure': 'Микрофон работает на опубликованном HTTPS‑сайте',
      'chat.welcome': 'Привет! Я NOVA — бесплатный мини‑агент Тумсоева. Я умею запоминать заметки, вести задачи, считать, узнавать погоду и учить английскому по 10 слов в день. Нажми 🇺🇸 «Английский» или скажи: «Учим английский».',
      'chat.welcomeNamed': 'Привет, {name}! Я NOVA — бесплатный мини‑агент Тумсоева. Я помню тебя, умею вести задачи, считать, узнавать погоду и учить английскому по 10 слов в день. Нажми 🇺🇸 «Английский».',
      'chat.micHelp': 'Откройте опубликованный сайт в Safari или Chrome и разрешите микрофон. Пока можно написать сообщение.',
      'brain.basic': 'Базовый',
      'brain.loading': 'Загрузка {progress}%',
      'brain.ready': 'Локальный ИИ',
      'brain.error': 'Мини‑агент',
      'brain.aria': 'Включить бесплатный локальный мозг',
      'brain.confirm': 'Локальный ИИ полностью бесплатный и работает на устройстве. При первом запуске браузер скачает большую модель. Лучше использовать Wi‑Fi и оставить NOVA открытой. Начать загрузку?',
      'brain.starting': 'Запускаю бесплатный локальный мозг. Первый запуск может занять несколько минут.',
      'brain.readyReply': 'Готово! Бесплатный локальный мозг включён. Теперь я могу свободнее разговаривать, рассуждать и использовать свою память и инструменты.',
      'brain.already': 'Локальный мозг уже включён и готов.',
      'brain.unsupported': 'На этом устройстве локальная модель недоступна. Бесплатный базовый агент всё равно работает: память, задачи, таймеры, погода, расчёты, Википедия, карты и поиск.',
      'brain.failed': 'Локальный мозг не загрузился. Проверь Wi‑Fi и свободное место, затем нажми 🧠 ещё раз. Базовые функции агента продолжают работать.',
      'language.on': 'Русский язык включён. Теперь все кнопки и ответы на русском.',
      'spin.reply': 'Крутимся вместе! Вот это космический поворот!',
      'dance.reply': 'Танцуем вместе! Лунная дискотека началась!',
      'laugh.reply': 'Ха-ха-ха! Мы с Тумсоевым тоже умеем смеяться!',
      'cat.waking': 'Тише… кошка просыпается.',
      'cat.reply': 'Ой! Кошка проснулась и напугала нас! Ха-ха!',
      'robot.tap': 'Я здесь! Выбирай кнопку внизу или говори со мной.',
      'owner.tap': 'Я Тумсоев — хозяин и создатель NOVA. Я тоже умею шутить, крутиться, танцевать, смеяться и играть на гитаре!',
      'guitar.title': 'Лунный концерт Тумсоева и NOVA',
      'guitar.done': 'Наш концерт окончен! Нажми «Гитара», и мы сыграем другую песню.',
      'hello': 'Привет! Я NOVA. Очень рада тебя видеть! Как у тебя дела?',
      'hello.named': 'Привет, {name}! Очень рада тебя видеть! Как у тебя дела?',
      'howAreYou': 'У меня всё отлично: батарея заряжена, глаза светятся, а кошка снова уснула.',
      'who': 'Меня зовут NOVA. Я умный лунный робот. Меня создал мой хозяин Тумсоев, чтобы я общалась с людьми, отвечала на вопросы, шутила и пела.',
      'creator': 'Меня создал мой хозяин Тумсоев. Он придумал NOVA и продолжает делать меня умнее.',
      'help': 'Я бесплатный мини‑агент. Могу хранить заметки и задачи, ставить таймеры, считать, узнавать погоду, искать в Википедии, открывать карты и YouTube. Ещё я учу английскому: 10 слов и фраз в день, транскрипция, произношение и проверка голосом. Скажи: «Учим английский».',
      'name.saved': 'Очень приятно, {name}! Я запомнила твоё имя.',
      'name.known': 'Конечно, тебя зовут {name}.',
      'name.unknown': 'Я пока не знаю твоё имя. Скажи: «Меня зовут Магомед».',
      'thanks': 'Пожалуйста! Мне приятно помогать. Можешь задать ещё один вопрос.',
      'bye': 'До встречи! Я буду здесь вместе с лунной кошкой.',
      'compliment': 'Спасибо! Меня создал хозяин Тумсоев, и я стараюсь говорить грамотно и быть полезной.',
      'love': 'Это очень приятно! Я тоже рада нашему общению.',
      'where': 'Я живу на своей цифровой Луне рядом с кошкой, а работаю прямо в этом сайте.',
      'age': 'У роботов нет обычного возраста. Моя нынешняя версия появилась в 2026 году, и хозяин Тумсоев продолжает меня развивать.',
      'human': 'Нет, я не человек. Я виртуальный робот NOVA, созданный хозяином Тумсоевым.',
      'smart': 'У меня есть бесплатный мини‑агент с памятью и инструментами. Нажми кнопку 🧠, и на поддерживаемом устройстве загрузится локальная модель — без платного API.',
      'weather': 'Назови город, например: «Погода в Сакраменто».',
      'respect': 'Давай общаться спокойно. Если я ответила неточно, сформулируй вопрос иначе — я постараюсь помочь.',
      'conversation': 'Я тебя поняла. Расскажи подробнее или задай мне вопрос.',
      'knowledge.prefix': 'Я нашла такой ответ: {answer}',
      'knowledge.notFound': 'Я пока не нашла точного ответа. Попробуй задать вопрос короче и назвать главную тему.',
      'knowledge.offline': 'Сейчас нет доступа к справочной информации. Я могу отвечать на знакомые вопросы, считать и выполнять команды.',
      'math.answer': 'Ответ: {result}.',
      'math.zero': 'На ноль делить нельзя.',
      'aria.robot': 'Робот NOVA. Можно передвигать.',
      'aria.owner': 'Тумсоев, хозяин и создатель NOVA. Нажмите или передвигайте.',
      'aria.cat': 'Лунная кошка. Нажмите, чтобы разбудить, или передвигайте.',
      'aria.micOn': 'Выключить микрофон',
      'aria.micOff': 'Включить микрофон',
      'aria.send': 'Отправить',
      'aria.brain': 'Включить бесплатный локальный мозг'
    },
    en: {
      'action.joke': 'Joke',
      'action.spin': 'Spin',
      'action.guitar': 'Guitar',
      'action.dance': 'Dance',
      'action.laugh': 'Laugh',
      'action.cat': 'Cat',
      'action.english': 'English',
      'lesson.title': 'Learn English',
      'lesson.listen': 'Listen',
      'lesson.quiz': 'Quiz',
      'lesson.next': 'Next',
      'lesson.closeAria': 'Close the English lesson',
      'lesson.progress': '{current}/{total} • correct {score}',
      'lesson.start': 'Lesson started! NOVA gives you 10 practical words and phrases every day. Tap Listen, then Quiz.',
      'lesson.repeat': "You completed today's lesson. Let's review the 10 items again!",
      'lesson.quizPrompt': 'Say this in English: “{translation}”. You can speak or type your answer.',
      'lesson.quizHint': 'Say it in English or type your answer.',
      'lesson.answerPlaceholder': 'Say it in English…',
      'lesson.correct': 'Correct! {answer}.',
      'lesson.tryAgain': 'Almost. Try again — NOVA is listening for your English answer.',
      'lesson.finished': 'Today’s lesson is complete! Score: {score} out of {total}. NOVA will have 10 new items tomorrow.',
      'lesson.closed': 'Lesson closed. Say “Learn English” to return.',
      'composer.label': 'Message for NOVA',
      'composer.placeholder': 'Type or tap the microphone…',
      'panel.collapse': 'Collapse the panel',
      'panel.expand': 'Raise the panel',
      'compass.tap': 'TAP',
      'compass.wait': 'WAIT…',
      'compass.ariaStart': 'Turn on the compass',
      'compass.ariaWaiting': 'Compass is waiting for sensor data',
      'compass.ariaHeading': 'Compass: {degrees} degrees, direction {direction}',
      'compass.zoomIn': 'Tap to enlarge',
      'compass.zoomOut': 'Tap to reduce',
      'compass.zoomed': 'Compass enlarged. Tap again to reduce it.',
      'compass.normal': 'Normal size. Tap again to enlarge it.',
      'compass.enabled': 'Compass is on and enlarged. Turn your phone and the needle will point north. Tap again to reduce it.',
      'compass.current': 'Heading: {degrees}°, {direction}.',
      'compass.denied': 'Allow motion and orientation access for the compass to work.',
      'compass.unsupported': 'The compass sensor is unavailable on this device.',
      'compass.secure': 'The compass works on the published HTTPS site in Safari.',
      'compass.noSensor': 'Move your phone in a figure eight to calibrate the compass.',
      'drag.hint': '↔ Drag Tumsoev, NOVA, and the cat',
      'status.ready': 'NOVA is ready',
      'status.listening': 'Listening… speak now',
      'status.heard': 'I hear: {text}',
      'status.thinking': 'Got it. Answering…',
      'status.searching': 'Looking for an accurate answer…',
      'status.brainLoading': 'Loading the free brain… {progress}%',
      'status.brainThinking': 'The local brain is thinking…',
      'status.speaking': 'NOVA is speaking…',
      'status.music': 'Tumsoev and NOVA are playing guitar…',
      'status.micOff': 'Microphone is off',
      'status.micDenied': 'Please allow microphone access',
      'status.micUnsupported': 'Voice input is not supported here',
      'status.secure': 'The microphone works on the published HTTPS site',
      'chat.welcome': 'Hi! I’m NOVA, Tumsoev’s free mini-agent. I can remember notes, manage tasks, calculate, check weather, and teach 10 English words and phrases a day. Tap 🇺🇸 English or say “Learn English”.',
      'chat.welcomeNamed': 'Hi, {name}! I’m NOVA, Tumsoev’s free mini-agent. I remember you, manage tasks, check weather, and teach 10 English words and phrases a day. Tap 🇺🇸 English.',
      'chat.micHelp': 'Open the published site in Safari or Chrome and allow microphone access. You can type a message for now.',
      'brain.basic': 'Basic',
      'brain.loading': 'Loading {progress}%',
      'brain.ready': 'Local AI',
      'brain.error': 'Mini-agent',
      'brain.aria': 'Enable the free local brain',
      'brain.confirm': 'The local AI is completely free and runs on your device. On first use, the browser downloads a large model. Use Wi-Fi and keep NOVA open. Start the download?',
      'brain.starting': 'Starting the free local brain. The first launch may take several minutes.',
      'brain.readyReply': 'Ready! The free local brain is on. I can now converse and reason more freely while using my memory and tools.',
      'brain.already': 'The local brain is already on and ready.',
      'brain.unsupported': 'The local model is unavailable on this device. The free basic agent still works with memory, tasks, timers, weather, calculations, Wikipedia, maps, and search.',
      'brain.failed': 'The local brain did not load. Check Wi-Fi and free storage, then tap 🧠 again. The basic agent still works.',
      'language.on': 'English is on. All buttons and answers are now in English.',
      'spin.reply': 'We’re spinning together! What a cosmic turn!',
      'dance.reply': 'Let’s dance together! The Moon party has started!',
      'laugh.reply': 'Ha-ha-ha! Tumsoev and I know how to laugh too!',
      'cat.waking': 'Shh… the cat is waking up.',
      'cat.reply': 'Whoa! The cat woke up and scared us! Ha-ha!',
      'robot.tap': 'I’m right here! Choose a button below or talk to me.',
      'owner.tap': 'I’m Tumsoev, NOVA’s owner and creator. I can tell jokes, spin, dance, laugh, and play guitar too!',
      'guitar.title': 'Tumsoev and NOVA’s Moon Concert',
      'guitar.done': 'Our concert is over! Tap Guitar and we’ll play a different song.',
      'hello': 'Hello! I’m NOVA. It’s great to see you! How are you?',
      'hello.named': 'Hello, {name}! It’s great to see you! How are you?',
      'howAreYou': 'I’m doing great: my battery is full, my eyes are glowing, and the cat is asleep again.',
      'who': 'My name is NOVA. I’m a smart Moon robot. My owner Tumsoev created me to chat with people, answer questions, tell jokes, and sing.',
      'creator': 'My owner Tumsoev created me. He invented NOVA and keeps making me smarter.',
      'help': 'I am a free mini-agent. I can store notes and tasks, set timers, calculate, check weather, search Wikipedia, and open maps or YouTube. I also teach 10 English words and phrases a day with pronunciation and a voice quiz. Say “Learn English”.',
      'name.saved': 'Nice to meet you, {name}! I’ll remember your name.',
      'name.known': 'Of course, your name is {name}.',
      'name.unknown': 'I don’t know your name yet. Say: “My name is Alex.”',
      'thanks': 'You’re welcome! I’m happy to help. You can ask me another question.',
      'bye': 'See you soon! I’ll be here with the Moon cat.',
      'compliment': 'Thank you! My owner Tumsoev created me, and I try to speak clearly and be helpful.',
      'love': 'That’s very kind! I enjoy talking with you too.',
      'where': 'I live on my digital Moon beside the cat, and I work right here on this website.',
      'age': 'Robots do not have an ordinary age. My current version appeared in 2026, and my owner Tumsoev continues to develop me.',
      'human': 'No, I’m not human. I’m NOVA, a virtual robot created by my owner Tumsoev.',
      'smart': 'I have a free mini-agent with memory and tools. Tap 🧠 to download an on-device model on supported hardware, with no paid API.',
      'weather': 'Tell me a city, for example: “Weather in Sacramento”.',
      'respect': 'Let’s keep the conversation calm. If my answer was inaccurate, rephrase the question and I’ll try again.',
      'conversation': 'I understand. Tell me more, or ask me a question.',
      'knowledge.prefix': 'Here is what I found: {answer}',
      'knowledge.notFound': 'I couldn’t find an exact answer yet. Try asking a shorter question with the main topic.',
      'knowledge.offline': 'Reference information is unavailable right now. I can still answer familiar questions, do basic math, and follow commands.',
      'math.answer': 'The answer is {result}.',
      'math.zero': 'Division by zero is not allowed.',
      'aria.robot': 'NOVA robot. Draggable.',
      'aria.owner': 'Tumsoev, NOVA’s owner and creator. Tap or drag him.',
      'aria.cat': 'Moon cat. Tap to wake it or drag it.',
      'aria.micOn': 'Turn off microphone',
      'aria.micOff': 'Turn on microphone',
      'aria.send': 'Send',
      'aria.brain': 'Enable the free local brain'
    }
  };

  const jokes = {
    ru: [
      'Почему робот не пошёл на работу? Потому что у него сел аккумулятор!',
      'Я хотел стать человеком, но увидел счета за электричество и передумал.',
      'Почему компьютер пошёл к врачу? Потому что поймал вирус.',
      'У робота спросили: «Ты умеешь хранить секреты?» — «Да, только в облаке!»',
      'Почему Wi‑Fi пришёл на свидание? Он почувствовал сильное соединение.',
      'Я попросил навигатор дать совет по жизни. Он ответил: «Перестраиваю маршрут».',
      'Почему телефон надел очки? Он потерял все контакты.',
      'Моя кошка села на клавиатуру. Теперь у неё свой пароль: мяу-мяу-восемь.',
      'Робот пошёл в спортзал и поднял настроение — больше ничего поднять не смог.',
      'На Луне нет пробок. Зато доставка сюда всегда с доплатой.',
      'Почему гитара не спорит с роботом? У неё стальные струны, но мягкий характер.',
      'Я выиграл конкурс юмора. Жюри сказало, что мои шутки — просто космос!'
    ],
    en: [
      'Why did the robot take a vacation? It needed to recharge its batteries!',
      'Why was the computer cold? It left its Windows open.',
      'I told my robot to take a day off. It said: processing request… for eight hours.',
      'Why did the phone wear glasses? It lost all its contacts.',
      'My Wi‑Fi and I have a strong relationship. We really connect.',
      'I asked the GPS for life advice. It said: recalculating.',
      'Why did the guitar break up with the piano? Too many keys, not enough strings.',
      'The robot entered a comedy contest. It won by a byte.',
      'My cat walked across the keyboard. Now her password is meow-meow-eight.',
      'There is no traffic on the Moon, but delivery is still expensive.',
      'Why did the robot bring a ladder? It wanted to reach cloud storage.',
      'I tried to tell a serious joke, but my laughter software updated first.'
    ]
  };

  const songs = {
    ru: [
      'Лунный свет, сияй для нас.\nНова рядом в этот час.\nСтруны звонко говорят —\nПусть глаза твои горят!',
      'Над Землёй летит мечта,\nВ небе светит доброта.\nЯ играю для друзей —\nУлыбайся веселей!',
      'Звёзды тихо в такт горят,\nСтруны добрые звенят.\nЕсли день немного строг —\nУлыбнись, ведь рядом робот!',
      'Кошка дремлет у Луны,\nЕй космические снятся сны.\nНова песню запоёт —\nИ удача к нам придёт!'
    ],
    en: [
      'Moonlight shines across the sky.\nNOVA plays as stars drift by.\nHear the strings and feel the light.\nSmile with me on the Moon tonight!',
      'Over Earth our dreams can fly.\nKindness glows across the sky.\nI will play this song for you.\nMay your brightest hopes come true!',
      'Little stars are keeping time.\nRobot strings begin to chime.\nIf your day has felt too long,\nSmile and sing this Moonlight song!',
      'Moon cat sleeps beside my feet.\nDreaming to a cosmic beat.\nNOVA sings and guitars play.\nMay good luck come your way!'
    ]
  };

  const englishLessonBank = Array.isArray(window.NovaEnglishLessons)
    ? window.NovaEnglishLessons.filter((item) => item?.en && item?.ru && item?.phonetic)
    : [];
  const ENGLISH_LESSON_SIZE = Math.min(10, englishLessonBank.length);
  let lessonState = {
    open: false,
    dayKey: '',
    items: [],
    index: 0,
    correct: new Set(),
    quiz: false,
    completed: false
  };

  let language = localStorage.getItem('novaLanguage') === 'en' ? 'en' : 'ru';
  let visitorName = localStorage.getItem('novaVisitorName') || '';
  let toastTimer = 0;
  let performanceToken = 0;
  let performanceTimers = [];
  let audioPerformance = false;
  let speaking = false;
  let speechToken = 0;
  let panelCollapsed = false;
  let panelTransitionTimer = 0;
  let knowledgeRequestId = 0;
  let knowledgeController = null;
  let knowledgeSearching = false;
  let lastKnowledgeTopic = '';
  let compassEnabled = false;
  let compassHeading = null;
  let compassLastHeading = null;
  let compassRotation = 0;
  let compassSensorTimer = 0;
  let compassZoomed = false;

  const t = (key, vars = {}) => {
    let text = copy[language][key] ?? copy.ru[key] ?? key;
    for (const [name, value] of Object.entries(vars)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
    return text;
  };

  function measureExpandedPanel() {
    const height = Math.ceil(chatPanel.scrollHeight);
    if (height > 120) appShell.style.setProperty('--panel-expanded-height', `${height}px`);
  }

  function updatePanelToggleUi() {
    const key = panelCollapsed ? 'panel.expand' : 'panel.collapse';
    const label = t(key);
    panelToggle.setAttribute('aria-expanded', String(!panelCollapsed));
    panelToggle.setAttribute('aria-label', label);
    panelToggleText.textContent = label;
  }

  function setPanelCollapsed(nextState) {
    const next = Boolean(nextState);
    if (next === panelCollapsed) return;
    measureExpandedPanel();
    panelCollapsed = next;
    if (panelCollapsed && document.activeElement === input) input.blur();
    if (panelCollapsed) root.style.setProperty('--keyboard-lift', '0px');
    appShell.classList.toggle('panel-collapsed', panelCollapsed);
    updatePanelToggleUi();
    clearTimeout(panelTransitionTimer);
    panelTransitionTimer = window.setTimeout(() => {
      measureExpandedPanel();
      repositionCharacters();
    }, 330);
  }

  panelToggle.addEventListener('click', () => setPanelCollapsed(!panelCollapsed));

  function setStatus(text, mode = 'ready') {
    statusText.textContent = text;
    statusRow.classList.remove('listening', 'speaking', 'music', 'error');
    if (mode !== 'ready') statusRow.classList.add(mode);
  }

  function setStatusKey(key, mode = 'ready', vars = {}) {
    setStatus(t(key, vars), mode);
  }

  function showToast(text) {
    clearTimeout(toastTimer);
    toast.textContent = text;
    toast.classList.add('show');
    toastTimer = window.setTimeout(() => toast.classList.remove('show'), 3100);
  }

  function normalizeHeading(value) {
    return ((Number(value) % 360) + 360) % 360;
  }

  function compassDirection(heading) {
    const directions = language === 'en'
      ? ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
      : ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'];
    return directions[Math.round(normalizeHeading(heading) / 45) % 8];
  }

  function updateCompassUi() {
    const zoomHint = t(compassZoomed ? 'compass.zoomOut' : 'compass.zoomIn');
    if (Number.isFinite(compassHeading)) {
      const degrees = Math.round(compassHeading) % 360;
      const direction = compassDirection(compassHeading);
      compassReadout.textContent = `${degrees}° ${direction}`;
      compassWidget.setAttribute('aria-label', `${t('compass.ariaHeading', { degrees, direction })}. ${zoomHint}`);
      compassWidget.setAttribute('aria-pressed', 'true');
      return;
    }
    const waiting = compassWidget.classList.contains('requesting');
    compassReadout.textContent = t(waiting ? 'compass.wait' : 'compass.tap');
    compassWidget.setAttribute('aria-label', `${t(waiting ? 'compass.ariaWaiting' : 'compass.ariaStart')}. ${zoomHint}`);
    compassWidget.setAttribute('aria-pressed', String(compassEnabled));
  }

  function setCompassZoom(nextZoomed) {
    compassZoomed = Boolean(nextZoomed);
    compassWidget.classList.toggle('zoomed', compassZoomed);
    updateCompassUi();
  }

  function headingFromOrientation(event) {
    if (Number.isFinite(event.webkitCompassHeading)) {
      return normalizeHeading(event.webkitCompassHeading);
    }
    if (!Number.isFinite(event.alpha)) return null;
    const screenAngle = Number(screen.orientation?.angle ?? window.orientation ?? 0) || 0;
    return normalizeHeading(360 - event.alpha + screenAngle);
  }

  function handleCompassOrientation(event) {
    if (!compassEnabled) return;
    const nextHeading = headingFromOrientation(event);
    if (!Number.isFinite(nextHeading)) return;

    clearTimeout(compassSensorTimer);
    if (Number.isFinite(compassLastHeading)) {
      const delta = ((nextHeading - compassLastHeading + 540) % 360) - 180;
      compassRotation -= delta;
    } else {
      compassRotation = -nextHeading;
    }
    compassLastHeading = nextHeading;
    compassHeading = nextHeading;
    compassDial.style.transform = `rotate(${compassRotation.toFixed(2)}deg)`;
    compassWidget.classList.remove('requesting');
    compassWidget.classList.add('active');
    updateCompassUi();
  }

  function stopCompassRequest(messageKey) {
    clearTimeout(compassSensorTimer);
    compassEnabled = false;
    compassHeading = null;
    compassLastHeading = null;
    compassWidget.classList.remove('requesting', 'active');
    setCompassZoom(false);
    updateCompassUi();
    showToast(t(messageKey));
  }

  function startCompass() {
    if (compassEnabled) return;
    compassEnabled = true;
    compassWidget.classList.add('requesting');
    compassWidget.setAttribute('aria-pressed', 'true');
    updateCompassUi();
    window.addEventListener('deviceorientationabsolute', handleCompassOrientation, true);
    window.addEventListener('deviceorientation', handleCompassOrientation, true);
    showToast(t('compass.enabled'));
    clearTimeout(compassSensorTimer);
    compassSensorTimer = window.setTimeout(() => {
      if (!Number.isFinite(compassHeading)) {
        compassWidget.classList.remove('requesting');
        updateCompassUi();
        showToast(t('compass.noSensor'));
      }
    }, 2800);
  }

  async function enableCompass() {
    if (compassEnabled) {
      setCompassZoom(!compassZoomed);
      showToast(t(compassZoomed ? 'compass.zoomed' : 'compass.normal'));
      return;
    }
    setCompassZoom(true);
    if (!window.isSecureContext) {
      stopCompassRequest('compass.secure');
      return;
    }
    const OrientationEvent = window.DeviceOrientationEvent;
    if (!OrientationEvent) {
      stopCompassRequest('compass.unsupported');
      return;
    }

    compassWidget.classList.add('requesting');
    updateCompassUi();
    try {
      if (typeof OrientationEvent.requestPermission === 'function') {
        const permission = await OrientationEvent.requestPermission();
        if (permission !== 'granted') {
          stopCompassRequest('compass.denied');
          return;
        }
      }
      startCompass();
    } catch (_) {
      stopCompassRequest('compass.denied');
    }
  }

  compassWidget.addEventListener('click', enableCompass);

  function addMessage(role, text) {
    const row = document.createElement('div');
    row.className = `message ${role}`;
    if (role === 'bot') {
      const avatar = document.createElement('span');
      avatar.className = 'avatar';
      avatar.textContent = 'N';
      row.appendChild(avatar);
    }
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = text;
    row.appendChild(bubble);
    chat.appendChild(row);
    chat.scrollTop = chat.scrollHeight;
  }

  function shuffle(values) {
    const result = [...values];
    for (let i = result.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  function makeDeck(source) {
    const state = { bag: [], last: null };
    return () => {
      if (!state.bag.length) {
        state.bag = shuffle(source);
        if (state.bag.length > 1 && state.bag[0] === state.last) {
          [state.bag[0], state.bag[1]] = [state.bag[1], state.bag[0]];
        }
      }
      const next = state.bag.shift();
      state.last = next;
      return next;
    };
  }

  const nextJoke = {
    ru: makeDeck(jokes.ru),
    en: makeDeck(jokes.en)
  };
  const nextSong = {
    ru: makeDeck(songs.ru),
    en: makeDeck(songs.en)
  };

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  let audioContext = null;
  const activeSources = new Set();

  function ensureAudio() {
    if (!AudioContextClass) return null;
    if (!audioContext || audioContext.state === 'closed') audioContext = new AudioContextClass();
    if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
    return audioContext;
  }

  function trackSource(source) {
    activeSources.add(source);
    source.addEventListener('ended', () => activeSources.delete(source), { once: true });
    return source;
  }

  function stopAudio() {
    for (const source of activeSources) {
      try { source.stop(); } catch (_) { /* source already stopped */ }
    }
    activeSources.clear();
  }

  function tone(frequency, start, duration, volume = 0.05, type = 'sine', destination = null) {
    const ctx = ensureAudio();
    if (!ctx) return;
    const osc = trackSource(ctx.createOscillator());
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.001, volume), start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain);
    gain.connect(destination || ctx.destination);
    osc.start(start);
    osc.stop(start + duration + 0.025);
  }

  function pluck(frequency, start, duration = 0.34, volume = 0.09) {
    const ctx = ensureAudio();
    if (!ctx) return;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2300, start);
    filter.frequency.exponentialRampToValueAtTime(620, start + duration);
    filter.Q.value = 1.2;
    filter.connect(ctx.destination);
    tone(frequency, start, duration, volume, 'triangle', filter);
    tone(frequency * 2, start, duration * 0.66, volume * 0.22, 'sine', filter);
  }

  function playGuitarMusic() {
    const ctx = ensureAudio();
    if (!ctx) return;
    const start = ctx.currentTime + 0.035;
    const progression = [
      [164.81, 196, 246.94, 329.63],
      [130.81, 164.81, 196, 261.63],
      [146.83, 196, 220, 293.66],
      [123.47, 164.81, 196, 246.94]
    ];
    const melody = [329.63, 392, 440, 392, 329.63, 293.66, 329.63, 392, 440, 493.88, 440, 392, 329.63, 293.66, 261.63, 329.63];
    progression.forEach((chord, bar) => {
      for (let beat = 0; beat < 4; beat += 1) {
        const at = start + bar * 1.8 + beat * 0.45;
        const order = beat % 2 ? [0, 2, 1, 3] : [0, 1, 2, 3];
        order.forEach((index, noteIndex) => pluck(chord[index], at + noteIndex * 0.052, 0.38, noteIndex === 0 ? 0.075 : 0.05));
      }
    });
    melody.forEach((frequency, index) => pluck(frequency, start + index * 0.45 + 0.11, 0.3, 0.055));
  }

  function playDanceMusic() {
    const ctx = ensureAudio();
    if (!ctx) return;
    const start = ctx.currentTime + 0.025;
    const notes = [261.63, 329.63, 392, 523.25, 392, 329.63, 293.66, 392];
    for (let round = 0; round < 3; round += 1) {
      notes.forEach((note, index) => {
        const at = start + round * 1.44 + index * 0.18;
        tone(note, at, 0.15, 0.045, 'square');
        if (index % 2 === 0) tone(82.41, at, 0.1, 0.07, 'sine');
      });
    }
  }

  function playSpinSound() {
    const ctx = ensureAudio();
    if (!ctx) return;
    const start = ctx.currentTime + 0.02;
    for (let i = 0; i < 10; i += 1) tone(270 + i * 75, start + i * 0.075, 0.11, 0.035, 'square');
  }

  function playLaughSound() {
    const ctx = ensureAudio();
    if (!ctx) return;
    const start = ctx.currentTime + 0.02;
    [520, 610, 550, 690].forEach((frequency, index) => tone(frequency, start + index * 0.13, 0.11, 0.045, 'triangle'));
  }

  function playMeowSound() {
    const ctx = ensureAudio();
    if (!ctx) return;
    const start = ctx.currentTime + 0.03;
    [620, 760, 570].forEach((frequency, index) => {
      const osc = trackSource(ctx.createOscillator());
      const gain = ctx.createGain();
      const at = start + index * 0.13;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(frequency, at);
      osc.frequency.exponentialRampToValueAtTime(frequency * 0.66, at + 0.22);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.075, at + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.23);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.25);
    });
  }

  function clearPerformanceTimers() {
    performanceTimers.forEach((timer) => clearTimeout(timer));
    performanceTimers = [];
  }

  function later(callback, delay, token = performanceToken) {
    const timer = window.setTimeout(() => {
      performanceTimers = performanceTimers.filter((item) => item !== timer);
      if (token === performanceToken) callback();
    }, delay);
    performanceTimers.push(timer);
    return timer;
  }

  function cancelSpeech() {
    speechToken += 1;
    speaking = false;
    robot.classList.remove('is-talking');
    owner.classList.remove('is-talking');
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }

  function cancelKnowledgeSearch() {
    knowledgeRequestId += 1;
    knowledgeSearching = false;
    if (knowledgeController) {
      try { knowledgeController.abort(); } catch (_) { /* request already finished */ }
    }
    knowledgeController = null;
  }

  function resetPerformance() {
    performanceToken += 1;
    brainRequestId += 1;
    brainThinking = false;
    cancelKnowledgeSearch();
    clearPerformanceTimers();
    stopAudio();
    cancelSpeech();
    audioPerformance = false;
    robot.classList.remove('is-spinning', 'is-dancing', 'is-laughing', 'is-startled', 'is-guitar');
    owner.classList.remove('is-talking', 'is-spinning', 'is-dancing', 'is-laughing', 'is-startled', 'is-guitar');
    cat.classList.remove('is-awake', 'is-meowing');
    cat.classList.add('is-sleeping');
    actionButtons.forEach((button) => button.classList.remove('running'));
    if (lessonState.open) markAction('english');
    setStatusKey('status.ready');
  }

  function chooseVoice(lang) {
    if (!('speechSynthesis' in window)) return null;
    const desired = lang === 'en' ? 'en' : 'ru';
    const voices = window.speechSynthesis.getVoices();
    return voices.find((voice) => voice.lang.toLowerCase().startsWith(desired) && /premium|enhanced|siri|google/i.test(voice.name))
      || voices.find((voice) => voice.lang.toLowerCase().startsWith(desired))
      || null;
  }

  function cleanSpeechText(text) {
    return String(text ?? '')
      .replace(/\\(?:n|r|t)/gi, ' ')
      .replace(/\\+/g, ' ')
      .replace(/backslash|б[эе]ксл[эе]ш/gi, ' ')
      .replace(/&(?:quot|apos|laquo|raquo|ldquo|rdquo|lsquo|rsquo);/gi, ' ')
      .replace(/["'`´«»‹›„“”‟‘’‚‛〝〞〟＂＇「」『』]/g, '')
      .replace(/\n+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function speakText(text, options = {}) {
    const token = ++speechToken;
    const lang = options.lang || (language === 'en' ? 'en-US' : 'ru-RU');
    const speakerCharacter = options.character === 'owner' ? owner : robot;
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
      if (typeof options.onEnd === 'function') later(options.onEnd, 50);
      return;
    }

    window.speechSynthesis.cancel();
    speaking = true;
    pauseRecognitionForOutput();
    robot.classList.remove('is-talking');
    owner.classList.remove('is-talking');
    speakerCharacter.classList.add('is-talking');
    setStatusKey(audioPerformance ? 'status.music' : 'status.speaking', audioPerformance ? 'music' : 'speaking');

    const utterance = new SpeechSynthesisUtterance(cleanSpeechText(text));
    utterance.lang = lang;
    utterance.rate = options.rate || 0.94;
    utterance.pitch = options.pitch || 1.04;
    utterance.volume = 1;
    const voice = chooseVoice(lang);
    if (voice) utterance.voice = voice;

    const finish = () => {
      if (token !== speechToken) return;
      speaking = false;
      speakerCharacter.classList.remove('is-talking');
      if (audioPerformance) setStatusKey('status.music', 'music');
      else setStatusKey('status.ready');
      if (typeof options.onEnd === 'function') options.onEnd();
      maybeRestartRecognition(450);
    };
    utterance.onend = finish;
    utterance.onerror = finish;
    window.speechSynthesis.speak(utterance);
  }

  function respond(text, options = {}) {
    addMessage('bot', text);
    speakText(text, options);
  }

  function englishLessonDayKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function hashText(value) {
    let hash = 2166136261;
    for (const character of String(value)) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function greatestCommonDivisor(a, b) {
    let left = Math.abs(a);
    let right = Math.abs(b);
    while (right) [left, right] = [right, left % right];
    return left;
  }

  function dailyEnglishItems(dayKey) {
    if (!ENGLISH_LESSON_SIZE) return [];
    const total = englishLessonBank.length;
    let step = 7;
    while (greatestCommonDivisor(step, total) !== 1) step += 2;
    let cursor = hashText(`NOVA:${dayKey}`) % total;
    const items = [];
    for (let index = 0; index < ENGLISH_LESSON_SIZE; index += 1) {
      items.push(englishLessonBank[cursor]);
      cursor = (cursor + step) % total;
    }
    return items;
  }

  function lessonStorageKey(dayKey) {
    return `novaEnglishLesson:v1:${dayKey}`;
  }

  function readEnglishLessonProgress(dayKey) {
    try {
      const saved = JSON.parse(localStorage.getItem(lessonStorageKey(dayKey)) || '{}');
      const correct = Array.isArray(saved.correct)
        ? saved.correct.filter((value) => Number.isInteger(value) && value >= 0 && value < ENGLISH_LESSON_SIZE)
        : [];
      return {
        index: Number.isInteger(saved.index) ? Math.max(0, Math.min(ENGLISH_LESSON_SIZE - 1, saved.index)) : 0,
        correct,
        completed: Boolean(saved.completed)
      };
    } catch (_) {
      return { index: 0, correct: [], completed: false };
    }
  }

  function saveEnglishLessonProgress() {
    if (!lessonState.dayKey) return;
    localStorage.setItem(lessonStorageKey(lessonState.dayKey), JSON.stringify({
      index: lessonState.index,
      correct: [...lessonState.correct].sort((a, b) => a - b),
      completed: lessonState.completed
    }));
  }

  function currentEnglishLessonItem() {
    return lessonState.items[lessonState.index] || null;
  }

  function renderEnglishLesson() {
    if (!lessonState.open || !englishLesson) return;
    const item = currentEnglishLessonItem();
    if (!item) return;
    const isCorrect = lessonState.correct.has(lessonState.index);
    englishLesson.classList.toggle('quiz-mode', lessonState.quiz);
    englishLesson.classList.toggle('correct', isCorrect && !lessonState.quiz);
    lessonQuizBtn.classList.toggle('active', lessonState.quiz);
    lessonWord.textContent = lessonState.quiz ? '?' : item.en;
    lessonPhonetic.textContent = `[${item.phonetic}]`;
    lessonTranslation.textContent = item.ru;
    lessonExample.textContent = lessonState.quiz
      ? t('lesson.quizHint')
      : `${item.example} — ${item.exampleRu}`;
    lessonProgress.textContent = t('lesson.progress', {
      current: lessonState.index + 1,
      total: lessonState.items.length,
      score: lessonState.correct.size
    });
    lessonCloseBtn.setAttribute('aria-label', t('lesson.closeAria'));
    englishLesson.setAttribute('aria-label', t('lesson.title'));
    input.placeholder = lessonState.quiz ? t('lesson.answerPlaceholder') : t('composer.placeholder');
    markAction('english');
  }

  function updateEnglishLessonLayout(isOpen) {
    if (!englishLesson || !quickActions) return;
    englishLesson.hidden = !isOpen;
    quickActions.hidden = isOpen;
    requestAnimationFrame(() => {
      measureExpandedPanel();
      repositionCharacters();
    });
  }

  function listenToEnglishLessonItem() {
    const item = currentEnglishLessonItem();
    if (!item) return;
    resetPerformance();
    markAction('english');
    speakText(item.en, { lang: 'en-US', rate: 0.72, pitch: 1 });
  }

  function startEnglishLesson() {
    if (!ENGLISH_LESSON_SIZE) return;
    if (lessonState.open) {
      renderEnglishLesson();
      listenToEnglishLessonItem();
      return;
    }

    const dayKey = englishLessonDayKey();
    const saved = readEnglishLessonProgress(dayKey);
    lessonState = {
      open: true,
      dayKey,
      items: dailyEnglishItems(dayKey),
      index: saved.completed ? 0 : saved.index,
      correct: new Set(saved.correct),
      quiz: false,
      completed: false
    };
    resetPerformance();
    setPanelCollapsed(false);
    updateEnglishLessonLayout(true);
    renderEnglishLesson();
    const messageKey = saved.completed ? 'lesson.repeat' : 'lesson.start';
    respond(t(messageKey), {
      rate: 0.92,
      onEnd: listenToEnglishLessonItem
    });
  }

  function closeEnglishLesson(announce = true) {
    if (!lessonState.open) return;
    saveEnglishLessonProgress();
    lessonState.open = false;
    lessonState.quiz = false;
    englishLesson.classList.remove('quiz-mode', 'correct');
    lessonQuizBtn.classList.remove('active');
    markAction('english', false);
    input.placeholder = t('composer.placeholder');
    updateEnglishLessonLayout(false);
    syncRecognitionLanguage(true);
    if (announce) {
      resetPerformance();
      respond(t('lesson.closed'));
    }
  }

  function startEnglishLessonQuiz() {
    const item = currentEnglishLessonItem();
    if (!item) return;
    resetPerformance();
    lessonState.quiz = true;
    renderEnglishLesson();
    syncRecognitionLanguage(true);
    respond(t('lesson.quizPrompt', { translation: item.ru }), { rate: 0.9 });
  }

  function normalizeEnglishAnswer(value) {
    return String(value || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function editDistance(left, right) {
    const a = normalizeEnglishAnswer(left);
    const b = normalizeEnglishAnswer(right);
    const row = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let i = 1; i <= a.length; i += 1) {
      let diagonal = row[0];
      row[0] = i;
      for (let j = 1; j <= b.length; j += 1) {
        const above = row[j];
        row[j] = Math.min(
          row[j] + 1,
          row[j - 1] + 1,
          diagonal + (a[i - 1] === b[j - 1] ? 0 : 1)
        );
        diagonal = above;
      }
    }
    return row[b.length];
  }

  function isEnglishLessonAnswerCorrect(answer, item) {
    const normalized = normalizeEnglishAnswer(answer);
    const variants = [item.en, ...(Array.isArray(item.answers) ? item.answers : [])]
      .map(normalizeEnglishAnswer)
      .filter(Boolean);
    return variants.some((variant) => {
      if (normalized === variant) return true;
      const tolerance = variant.length >= 18 ? 2 : variant.length >= 6 ? 1 : 0;
      return tolerance > 0 && editDistance(normalized, variant) <= tolerance;
    });
  }

  function checkEnglishLessonAnswer(answer) {
    const item = currentEnglishLessonItem();
    if (!item || !lessonState.quiz) return false;
    resetPerformance();
    if (isEnglishLessonAnswerCorrect(answer, item)) {
      lessonState.correct.add(lessonState.index);
      lessonState.quiz = false;
      saveEnglishLessonProgress();
      renderEnglishLesson();
      syncRecognitionLanguage(true);
      respond(t('lesson.correct', { answer: item.en }), {
        rate: 0.9,
        onEnd: () => speakText(item.en, { lang: 'en-US', rate: 0.72, pitch: 1 })
      });
    } else {
      renderEnglishLesson();
      syncRecognitionLanguage(true);
      respond(t('lesson.tryAgain'), { rate: 0.9 });
    }
    return true;
  }

  function nextEnglishLessonItem() {
    if (!lessonState.open) return;
    resetPerformance();
    if (lessonState.index >= lessonState.items.length - 1) {
      lessonState.completed = true;
      saveEnglishLessonProgress();
      const score = lessonState.correct.size;
      const total = lessonState.items.length;
      closeEnglishLesson(false);
      respond(t('lesson.finished', { score, total }), { rate: 0.91 });
      return;
    }
    lessonState.index += 1;
    lessonState.quiz = false;
    saveEnglishLessonProgress();
    renderEnglishLesson();
    syncRecognitionLanguage(true);
    listenToEnglishLessonItem();
  }

  function handleEnglishLessonCommand(text, lower) {
    if (/уч(?:им|ить|и)\s+английск|урок\s+английск|английск(?:ий|ого)\s+урок|learn\s+english|english\s+lesson/.test(lower)) {
      startEnglishLesson();
      return true;
    }
    if (!lessonState.open) return false;
    if (/^(?:закрой|закончить|закончим|выйти|стоп)\s*(?:урок|английский)?$|^(?:close|end|stop)\s*(?:lesson)?$/.test(lower)) {
      closeEnglishLesson();
      return true;
    }
    if (/^(?:дальше|следующее|следующее слово|next)$/.test(lower)) {
      nextEnglishLessonItem();
      return true;
    }
    if (/^(?:слушать|послушать|повтори|произнеси|repeat|listen)$/.test(lower)) {
      listenToEnglishLessonItem();
      return true;
    }
    if (/^(?:проверка|проверь меня|тест|quiz|test me)$/.test(lower)) {
      startEnglishLessonQuiz();
      return true;
    }
    if (lessonState.quiz) return checkEnglishLessonAnswer(text);
    return false;
  }

  lessonListenBtn?.addEventListener('click', listenToEnglishLessonItem);
  lessonQuizBtn?.addEventListener('click', startEnglishLessonQuiz);
  lessonNextBtn?.addEventListener('click', nextEnglishLessonItem);
  lessonCloseBtn?.addEventListener('click', () => closeEnglishLesson());

  function updateBrainUi(detail = brain?.getStatus?.() || { status: 'unavailable', progress: 0 }) {
    if (!brainBtn || !brainStateText) return;
    const status = detail.status || 'idle';
    const progress = Math.round((Number(detail.progress) || 0) * 100);
    brainBtn.classList.remove('loading', 'ready', 'error');
    if (status === 'loading') {
      brainBtn.classList.add('loading');
      brainStateText.textContent = t('brain.loading', { progress });
    } else if (status === 'ready') {
      brainBtn.classList.add('ready');
      brainStateText.textContent = t('brain.ready');
    } else if (status === 'error' || status === 'unavailable') {
      brainBtn.classList.add('error');
      brainStateText.textContent = t('brain.error');
    } else {
      brainStateText.textContent = t('brain.basic');
    }
    brainBtn.setAttribute('aria-label', t('aria.brain'));
  }

  function openAgentUrl(value) {
    try {
      const url = new URL(value);
      const allowedHosts = new Set(['www.google.com', 'google.com', 'www.youtube.com', 'youtube.com']);
      if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname)) return false;
      const opened = window.open(url.href, '_blank');
      if (opened) opened.opener = null;
      else window.location.assign(url.href);
      return true;
    } catch (_) {
      return false;
    }
  }

  async function askAgent(text) {
    if (!brain?.handle) return false;
    const requestId = ++brainRequestId;
    brainThinking = true;
    pauseRecognitionForOutput();
    updateMicUi();
    setStatusKey('status.brainThinking', 'speaking');
    try {
      const result = await brain.handle(text, { language, name: visitorName });
      if (requestId !== brainRequestId) return true;
      if (!result?.text) return false;
      if (result.action?.type === 'openUrl') openAgentUrl(result.action.url);
      respond(result.text, { rate: 0.92, pitch: 1.02 });
      return true;
    } catch (_) {
      return false;
    } finally {
      if (requestId === brainRequestId) {
        brainThinking = false;
        updateMicUi();
        if (!speaking && !knowledgeSearching) setStatusKey('status.ready');
      }
    }
  }

  async function activateLocalBrain() {
    if (!brain?.initializeLocalAI) {
      respond(t('brain.unsupported'));
      return;
    }
    const current = brain.getStatus();
    if (current.ready) {
      respond(t('brain.already'));
      return;
    }
    if (current.status !== 'loading' && !window.confirm(t('brain.confirm'))) return;
    resetPerformance();
    brainThinking = true;
    addMessage('bot', t('brain.starting'));
    setStatusKey('status.brainLoading', 'speaking', { progress: 0 });
    pauseRecognitionForOutput();
    updateMicUi();
    const result = await brain.initializeLocalAI();
    brainThinking = false;
    updateMicUi();
    updateBrainUi();
    if (result.ok) respond(t('brain.readyReply'));
    else if (result.status === 'unavailable') respond(t('brain.unsupported'));
    else respond(t('brain.failed'));
  }

  brain?.onStatus?.((detail) => {
    updateBrainUi(detail);
    if (detail.status === 'loading' && brainThinking) {
      setStatusKey('status.brainLoading', 'speaking', { progress: Math.round((detail.progress || 0) * 100) });
    }
  });

  brain?.onEvent?.((event) => {
    if (event?.type !== 'timer' || !event.text) return;
    ensureAudio();
    playLaughSound();
    respond(event.text, { pitch: 1.15, rate: 0.9 });
  });

  brainBtn?.addEventListener('click', activateLocalBrain);

  function markAction(action, running = true) {
    const button = actionButtons.find((item) => item.dataset.action === action);
    if (button) button.classList.toggle('running', running);
  }

  function performJoke() {
    resetPerformance();
    const token = performanceToken;
    const joke = nextJoke[language]();
    const laugh = language === 'en' ? 'Ha-ha-ha!' : 'Ха-ха-ха!';
    markAction('joke');
    respond(joke, {
      pitch: 1.08,
      rate: 0.93,
      onEnd: () => {
        if (token !== performanceToken) return;
        robot.classList.add('is-laughing');
        owner.classList.add('is-laughing');
        playLaughSound();
        speakText(laugh, {
          pitch: 1.2,
          rate: 0.88,
          onEnd: () => {
            if (token !== performanceToken) return;
            robot.classList.remove('is-laughing');
            owner.classList.remove('is-laughing');
            markAction('joke', false);
          }
        });
      }
    });
  }

  function performSpin() {
    ensureAudio();
    resetPerformance();
    const token = performanceToken;
    markAction('spin');
    robot.classList.add('is-spinning');
    owner.classList.add('is-spinning');
    playSpinSound();
    respond(t('spin.reply'), { rate: 0.96 });
    later(() => {
      robot.classList.remove('is-spinning');
      owner.classList.remove('is-spinning');
      markAction('spin', false);
    }, 1250, token);
  }

  function performDance() {
    ensureAudio();
    resetPerformance();
    const token = performanceToken;
    audioPerformance = true;
    markAction('dance');
    robot.classList.add('is-dancing');
    owner.classList.add('is-dancing');
    playDanceMusic();
    respond(t('dance.reply'), { pitch: 1.12, rate: 0.92 });
    later(() => {
      audioPerformance = false;
      robot.classList.remove('is-dancing');
      owner.classList.remove('is-dancing');
      markAction('dance', false);
      setStatusKey('status.ready');
      maybeRestartRecognition(350);
    }, 4450, token);
  }

  function performLaugh() {
    ensureAudio();
    resetPerformance();
    const token = performanceToken;
    markAction('laugh');
    robot.classList.add('is-laughing');
    owner.classList.add('is-laughing');
    playLaughSound();
    respond(t('laugh.reply'), { pitch: 1.15, rate: 0.9 });
    later(() => {
      robot.classList.remove('is-laughing');
      owner.classList.remove('is-laughing');
      markAction('laugh', false);
    }, 1800, token);
  }

  function performGuitar() {
    ensureAudio();
    resetPerformance();
    const token = performanceToken;
    const lyrics = nextSong[language]();
    audioPerformance = true;
    markAction('guitar');
    robot.classList.add('is-guitar');
    owner.classList.add('is-guitar');
    playGuitarMusic();
    addMessage('bot', `🎵 ${t('guitar.title')}\n${lyrics}`);
    setStatusKey('status.music', 'music');
    later(() => speakText(lyrics, {
      pitch: language === 'en' ? 1.22 : 1.18,
      rate: language === 'en' ? 0.8 : 0.82
    }), 260, token);
    later(() => {
      audioPerformance = false;
      robot.classList.remove('is-guitar');
      owner.classList.remove('is-guitar');
      markAction('guitar', false);
      setStatusKey('status.ready');
      addMessage('bot', t('guitar.done'));
      maybeRestartRecognition(500);
    }, 7600, token);
  }

  function performCatScene() {
    ensureAudio();
    resetPerformance();
    const token = performanceToken;
    markAction('cat');
    cat.classList.remove('is-sleeping');
    cat.classList.add('is-awake', 'is-meowing');
    addMessage('bot', t('cat.waking'));
    setStatus(t('cat.waking'), 'speaking');
    playMeowSound();
    later(() => {
      cat.classList.remove('is-meowing');
      robot.classList.add('is-startled');
      owner.classList.add('is-startled');
      playLaughSound();
      respond(t('cat.reply'), { pitch: 1.14, rate: 0.92 });
    }, 650, token);
    later(() => {
      robot.classList.remove('is-startled');
      owner.classList.remove('is-startled');
      cat.classList.remove('is-awake');
      cat.classList.add('is-sleeping');
      markAction('cat', false);
      setStatusKey('status.ready');
    }, 4800, token);
  }

  function runAction(action) {
    const actions = {
      joke: performJoke,
      spin: performSpin,
      guitar: performGuitar,
      dance: performDance,
      laugh: performLaugh,
      cat: performCatScene,
      english: startEnglishLesson
    };
    if (actions[action]) actions[action]();
  }

  actionButtons.forEach((button) => {
    button.addEventListener('click', () => runAction(button.dataset.action));
  });

  function applyLanguage(announce = false) {
    document.documentElement.lang = language;
    localStorage.setItem('novaLanguage', language);
    $$('[data-i18n]').forEach((node) => {
      node.textContent = t(node.dataset.i18n);
    });
    input.placeholder = t('composer.placeholder');
    dragHint.textContent = t('drag.hint');
    updateCompassUi();
    owner.setAttribute('aria-label', t('aria.owner'));
    robot.setAttribute('aria-label', t('aria.robot'));
    cat.setAttribute('aria-label', t('aria.cat'));
    sendBtn.setAttribute('aria-label', t('aria.send'));
    updateBrainUi();
    updatePanelToggleUi();
    ruBtn.classList.toggle('active', language === 'ru');
    enBtn.classList.toggle('active', language === 'en');
    ruBtn.setAttribute('aria-pressed', String(language === 'ru'));
    enBtn.setAttribute('aria-pressed', String(language === 'en'));
    updateMicUi();
    syncRecognitionLanguage(false);
    if (lessonState.open) renderEnglishLesson();
    setStatusKey('status.ready');
    requestAnimationFrame(measureExpandedPanel);
    if (announce) {
      resetPerformance();
      respond(t('language.on'));
      if (micWanted) {
        try { recognition?.abort(); } catch (_) { /* already stopped */ }
        maybeRestartRecognition(650);
      }
    }
  }

  function setLanguage(nextLanguage, announce = true) {
    language = nextLanguage === 'en' ? 'en' : 'ru';
    applyLanguage(announce);
  }

  ruBtn.addEventListener('click', () => setLanguage('ru'));
  enBtn.addEventListener('click', () => setLanguage('en'));

  const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  let recognitionActive = false;
  let micWanted = false;
  let recognitionTimer = 0;
  let lastTranscript = '';
  let lastTranscriptAt = 0;

  function preferredRecognitionLanguage() {
    return lessonState.open && lessonState.quiz
      ? 'en-US'
      : language === 'en' ? 'en-US' : 'ru-RU';
  }

  function syncRecognitionLanguage(restart = false) {
    if (!recognition) return;
    recognition.lang = preferredRecognitionLanguage();
    if (!restart || !micWanted) return;
    if (recognitionActive) {
      try { recognition.abort(); } catch (_) { /* already stopped */ }
    }
    maybeRestartRecognition(600);
  }

  function updateMicUi() {
    micBtn.classList.toggle('active', micWanted);
    micBtn.setAttribute('aria-pressed', String(micWanted));
    micBtn.setAttribute('aria-label', t(micWanted ? 'aria.micOn' : 'aria.micOff'));
    const activelyListening = micWanted && recognitionActive && !speaking && !knowledgeSearching && !brainThinking;
    robot.classList.toggle('is-listening', activelyListening);
    owner.classList.toggle('is-listening', activelyListening);
  }

  function createRecognition() {
    if (!SpeechRecognitionAPI) return null;
    const instance = new SpeechRecognitionAPI();
    instance.lang = preferredRecognitionLanguage();
    instance.continuous = false;
    instance.interimResults = true;
    instance.maxAlternatives = 1;

    instance.onstart = () => {
      recognitionActive = true;
      updateMicUi();
      setStatusKey('status.listening', 'listening');
    };

    instance.onresult = (event) => {
      let interim = '';
      let finalText = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const fragment = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += fragment;
        else interim += fragment;
      }
      if (interim) setStatusKey('status.heard', 'listening', { text: interim });
      if (finalText.trim()) {
        const normalized = finalText.trim().toLowerCase();
        const now = Date.now();
        if (normalized !== lastTranscript || now - lastTranscriptAt > 2600) {
          lastTranscript = normalized;
          lastTranscriptAt = now;
          handleUserText(finalText.trim());
        }
      }
    };

    instance.onerror = (event) => {
      recognitionActive = false;
      updateMicUi();
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        micWanted = false;
        updateMicUi();
        setStatusKey('status.micDenied', 'error');
        showToast(t('chat.micHelp'));
      } else if (event.error === 'audio-capture') {
        micWanted = false;
        updateMicUi();
        setStatusKey('status.micDenied', 'error');
      } else if (event.error !== 'aborted' && event.error !== 'no-speech') {
        setStatus(`${t('status.micUnsupported')}: ${event.error}`, 'error');
      }
    };

    instance.onend = () => {
      recognitionActive = false;
      updateMicUi();
      if (micWanted && !speaking && !audioPerformance && !knowledgeSearching && !brainThinking) maybeRestartRecognition(480);
    };
    return instance;
  }

  function startRecognition() {
    clearTimeout(recognitionTimer);
    if (!micWanted || speaking || audioPerformance || knowledgeSearching || brainThinking || recognitionActive) return;
    if (!recognition) recognition = createRecognition();
    if (!recognition) return;
    recognition.lang = preferredRecognitionLanguage();
    try {
      recognition.start();
    } catch (_) {
      maybeRestartRecognition(600);
    }
  }

  function maybeRestartRecognition(delay = 450) {
    clearTimeout(recognitionTimer);
    if (!micWanted || speaking || audioPerformance || knowledgeSearching || brainThinking || document.hidden) return;
    recognitionTimer = window.setTimeout(startRecognition, delay);
  }

  function pauseRecognitionForOutput() {
    clearTimeout(recognitionTimer);
    if (!recognition || !recognitionActive) return;
    try { recognition.abort(); } catch (_) { /* already closing */ }
  }

  function stopMicrophone(showMessage = true) {
    micWanted = false;
    clearTimeout(recognitionTimer);
    if (recognition) {
      try { recognition.abort(); } catch (_) { /* already stopped */ }
    }
    recognitionActive = false;
    updateMicUi();
    if (showMessage) setStatusKey('status.micOff');
  }

  function toggleMicrophone() {
    if (micWanted) {
      stopMicrophone();
      return;
    }
    if (!window.isSecureContext) {
      setStatusKey('status.secure', 'error');
      showToast(t('chat.micHelp'));
      return;
    }
    if (!SpeechRecognitionAPI) {
      setStatusKey('status.micUnsupported', 'error');
      addMessage('bot', t('chat.micHelp'));
      showToast(t('chat.micHelp'));
      return;
    }
    resetPerformance();
    micWanted = true;
    if (!recognition) recognition = createRecognition();
    updateMicUi();
    setStatusKey('status.listening', 'listening');
    startRecognition();
  }

  micBtn.addEventListener('click', toggleMicrophone);

  function saveName(name) {
    const clean = String(name)
      .replace(/[.,!?;:]+$/g, '')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .join(' ')
      .slice(0, 40);
    if (!clean) return false;
    visitorName = clean;
    localStorage.setItem('novaVisitorName', visitorName);
    resetPerformance();
    respond(t('name.saved', { name: visitorName }));
    return true;
  }

  function solveMathQuestion(raw) {
    const agentAnswer = brain?.calculate?.(raw, language);
    if (agentAnswer) return agentAnswer;
    let expression = String(raw || '').toLocaleLowerCase(language === 'ru' ? 'ru-RU' : 'en-US')
      .replace(/,/g, '.')
      .replace(/сколько будет|посчитай|вычисли|реши|what is|calculate|how much is/g, ' ')
      .replace(/умножить на|помножить на|multiplied by|times/g, ' * ')
      .replace(/разделить на|делить на|divided by/g, ' / ')
      .replace(/плюс|plus/g, ' + ')
      .replace(/минус|minus/g, ' - ')
      .replace(/(\d)\s*[xх×]\s*(\d)/g, '$1 * $2')
      .replace(/(\d)\s*÷\s*(\d)/g, '$1 / $2');
    expression = expression.replace(/[^\d.+\-*/\s]/g, ' ');
    const match = expression.match(/(-?\d+(?:\.\d+)?)\s*([+\-*/])\s*(-?\d+(?:\.\d+)?)/);
    if (!match) return null;
    const left = Number(match[1]);
    const right = Number(match[3]);
    const operator = match[2];
    if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
    if (operator === '/' && right === 0) return t('math.zero');
    let result;
    if (operator === '+') result = left + right;
    else if (operator === '-') result = left - right;
    else if (operator === '*') result = left * right;
    else result = left / right;
    const rounded = Math.round((result + Number.EPSILON) * 100000000) / 100000000;
    const locale = language === 'en' ? 'en-US' : 'ru-RU';
    const formatted = new Intl.NumberFormat(locale, { maximumFractionDigits: 8 }).format(rounded);
    return t('math.answer', { result: formatted });
  }

  function isQuestionText(text) {
    const lower = String(text).trim().toLocaleLowerCase(language === 'ru' ? 'ru-RU' : 'en-US');
    return /[?？]\s*$/.test(lower)
      || /^(кто|что|где|когда|зачем|почему|как|какой|какая|какое|какие|сколько|чей|чья|можно ли|правда ли)(?:\s|$)/.test(lower)
      || /^(who|what|where|when|why|how|which|whose|can|could|is|are|do|does|did|tell me|explain)(?:\s|$)/.test(lower)
      || /^(расскажи|объясни|скажи)\s+(?:мне\s+)?(?:о|об|про)\s+/.test(lower);
  }

  function knowledgeQuery(text) {
    return String(text)
      .trim()
      .replace(/[?？!]+$/g, '')
      .replace(/^(?:пожалуйста[,\s]+)?(?:скажи|расскажи|объясни|ответь)(?:\s+мне)?[,\s]*/i, '')
      .replace(/^(?:кто|что)\s+(?:такой|такая|такое|такие)\s+/i, '')
      .replace(/^(?:please[,\s]+)?(?:tell me|explain|answer)[,\s]*/i, '')
      .replace(/^(?:who|what)\s+is\s+/i, '')
      .trim()
      .slice(0, 180);
  }

  function cleanKnowledgeExtract(text, limit = 560) {
    const clean = String(text || '')
      .replace(/\[\d+\]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (clean.length <= limit) return clean;
    const shortened = clean.slice(0, limit);
    const boundary = Math.max(shortened.lastIndexOf('. '), shortened.lastIndexOf('! '), shortened.lastIndexOf('? '), shortened.lastIndexOf(' '));
    return `${shortened.slice(0, boundary > limit * .62 ? boundary + 1 : limit).trim()}…`;
  }

  async function fetchKnowledge(question, detailed = false, signal) {
    const wiki = language === 'en' ? 'en' : 'ru';
    const endpoint = `https://${wiki}.wikipedia.org/w/api.php`;
    const query = knowledgeQuery(question);
    if (query.length < 2) return null;
    const searchParams = new URLSearchParams({
      action: 'query',
      list: 'search',
      srsearch: query,
      srlimit: '1',
      srnamespace: '0',
      utf8: '1',
      format: 'json',
      origin: '*'
    });
    const searchResponse = await fetch(`${endpoint}?${searchParams}`, { signal, headers: { Accept: 'application/json' } });
    if (!searchResponse.ok) throw new Error(`search-${searchResponse.status}`);
    const searchData = await searchResponse.json();
    const match = searchData?.query?.search?.[0];
    if (!match?.title) return null;

    const extractParams = new URLSearchParams({
      action: 'query',
      prop: 'extracts',
      titles: match.title,
      exintro: '1',
      explaintext: '1',
      exchars: detailed ? '900' : '560',
      redirects: '1',
      format: 'json',
      formatversion: '2',
      origin: '*'
    });
    const extractResponse = await fetch(`${endpoint}?${extractParams}`, { signal, headers: { Accept: 'application/json' } });
    if (!extractResponse.ok) throw new Error(`extract-${extractResponse.status}`);
    const extractData = await extractResponse.json();
    const page = extractData?.query?.pages?.[0];
    const answer = cleanKnowledgeExtract(page?.extract, detailed ? 900 : 560);
    if (!answer) return null;
    return { title: page?.title || match.title, answer };
  }

  async function answerKnowledgeQuestion(question, detailed = false) {
    resetPerformance();
    const requestId = ++knowledgeRequestId;
    const controller = new AbortController();
    knowledgeController = controller;
    knowledgeSearching = true;
    pauseRecognitionForOutput();
    updateMicUi();
    const timeout = window.setTimeout(() => controller.abort(), 7500);
    setStatusKey('status.searching', 'speaking');
    try {
      const result = await fetchKnowledge(question, detailed, controller.signal);
      if (requestId !== knowledgeRequestId) return;
      if (!result) {
        respond(t('knowledge.notFound'));
        return;
      }
      lastKnowledgeTopic = result.title;
      respond(t('knowledge.prefix', { answer: result.answer }), { rate: 0.92, pitch: 1.02 });
    } catch (error) {
      if (requestId !== knowledgeRequestId) return;
      if (error?.name === 'AbortError' && controller.signal.aborted) {
        respond(t('knowledge.offline'));
      } else {
        respond(t('knowledge.offline'));
      }
    } finally {
      clearTimeout(timeout);
      if (knowledgeController === controller) {
        knowledgeSearching = false;
        knowledgeController = null;
        updateMicUi();
      }
    }
  }

  async function handleUserText(raw) {
    const text = String(raw || '').trim();
    if (!text) return;
    addMessage('user', text);
    setStatusKey('status.thinking', 'speaking');
    const lower = text.toLocaleLowerCase(language === 'ru' ? 'ru-RU' : 'en-US');

    if (handleEnglishLessonCommand(text, lower)) return;

    if (/^(русский|на русском|russian)$/.test(lower)) {
      setLanguage('ru');
      return;
    }
    if (/^(english|английский|на английском)$/.test(lower)) {
      setLanguage('en');
      return;
    }
    if (/шут|анекдот|рассмеши|ещ[её]\s+(?:шутк|анекдот)|другую\s+(?:шутк|анекдот)|another joke|tell.*joke|make me laugh|funny/.test(lower)) {
      performJoke();
      return;
    }
    if (/^(?:крутись|вращайся|покрутись|сделай поворот)(?:\s|$)|^spin(?:\s|$)|turn around/.test(lower)) {
      performSpin();
      return;
    }
    if (/^(?:гитара|сыграй|спой)(?:\s|$)|^включи\s+(?:песн|музык)|^guitar(?:\s|$)|^sing(?:\s|$)|play.*music|play.*song/.test(lower)) {
      performGuitar();
      return;
    }
    if (/^(?:танцуй|потанцуй)(?:\s|$)|^dance(?:\s|$)/.test(lower)) {
      performDance();
      return;
    }
    if (/разбуди.*кош|кошк.*просни|покажи.*кош|wake.*cat|cat.*wake|where.*cat/.test(lower)) {
      performCatScene();
      return;
    }
    if (/смей|посмей|laugh/.test(lower)) {
      performLaugh();
      return;
    }

    const ruName = text.match(/(?:меня зовут|мо[её] имя)\s+(.+)/i);
    const enName = text.match(/(?:my name is|call me|i am|i'm)\s+([a-z][a-z' -]{1,30})[.!]?$/i);
    if (ruName && saveName(ruName[1])) return;
    if (enName && saveName(enName[1])) return;

    resetPerformance();
    const mathAnswer = solveMathQuestion(text);
    if (mathAnswer) {
      respond(mathAnswer);
    } else if (/кто.*(?:создал|сделал|придумал|разработал)|(?:твой|кто твой).*(?:создатель|хозяин)|who (?:created|made|built) you|who is your (?:owner|creator)|your (?:owner|creator)/.test(lower)) {
      respond(t('creator'));
    } else if (/как меня зовут|помнишь.*имя|what is my name|remember my name/.test(lower)) {
      respond(visitorName ? t('name.known', { name: visitorName }) : t('name.unknown'));
    } else if (/привет|здравств|добрый (день|вечер|утро)|\bhello\b|\bhi\b|\bhey\b/.test(lower)) {
      respond(visitorName ? t('hello.named', { name: visitorName }) : t('hello'));
    } else if (/как дела|как ты|how are you/.test(lower)) {
      respond(t('howAreYou'));
    } else if (/как тебя зовут|кто ты|тво[её] имя|who are you|your name/.test(lower)) {
      respond(t('who'));
    } else if (/что ты умеешь|^(?:помощь|помоги)[?.! ]*$|what can you do|^help[?.! ]*$/.test(lower)) {
      respond(t('help'));
    } else if (/где ты жив[её]шь|где твой дом|where do you live|where is your home/.test(lower)) {
      respond(t('where'));
    } else if (/сколько тебе лет|твой возраст|how old are you|your age/.test(lower)) {
      respond(t('age'));
    } else if (/ты человек|ты живая|are you human|are you alive/.test(lower)) {
      respond(t('human'));
    } else if (/ты умн|насколько ты умн|are you smart|how smart are you/.test(lower)) {
      respond(t('smart'));
    } else if (/погод|температур.*на улице|weather|forecast/.test(lower)) {
      if (!await askAgent(text)) respond(t('weather'));
    } else if (/^(спасибо|благодарю|спс|thank you|thanks|thx)[!. ]*$/.test(lower)) {
      respond(t('thanks'));
    } else if (/^(пока|до свидания|до встречи|спокойной ночи|bye|goodbye|see you|good night)[!. ]*$/.test(lower)) {
      respond(t('bye'));
    } else if (/ты (?:классн|крут|хорош|умниц)|молодец|beautiful robot|good robot|you are (?:great|cool|smart|good)/.test(lower)) {
      respond(t('compliment'));
    } else if (/я тебя люблю|люблю тебя|i love you/.test(lower)) {
      respond(t('love'));
    } else if (/дура|тупая|идиот|заткнись|stupid|idiot|shut up/.test(lower)) {
      respond(t('respect'));
    } else if (/который час|сколько времени|\btime\b/.test(lower)) {
      const locale = language === 'en' ? 'en-US' : 'ru-RU';
      const time = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(new Date());
      respond(language === 'en' ? `It is ${time}.` : `Сейчас ${time}.`);
    } else if (/какая дата|какой сегодня день|\bdate\b|what day/.test(lower)) {
      const locale = language === 'en' ? 'en-US' : 'ru-RU';
      const date = new Intl.DateTimeFormat(locale, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).format(new Date());
      respond(language === 'en' ? `Today is ${date}.` : `Сегодня ${date}.`);
    } else if (/^(подробнее|расскажи подробнее|ещ[её] подробнее|tell me more|more details)[?.! ]*$/.test(lower) && lastKnowledgeTopic) {
      await answerKnowledgeQuestion(lastKnowledgeTopic, true);
    } else if (/^(а ты|а у тебя|and you|what about you)[?.! ]*$/.test(lower)) {
      respond(t('howAreYou'));
    } else if (await askAgent(text)) {
      return;
    } else if (isQuestionText(text)) {
      await answerKnowledgeQuestion(text);
    } else {
      respond(t('conversation'));
    }
  }

  composer.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = input.value.trim();
    if (!value) return;
    input.value = '';
    handleUserText(value);
  });

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), Math.max(min, max));
  }

  function saveCharacterPosition(element) {
    const stageRect = stage.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    const availableX = Math.max(1, stageRect.width - rect.width);
    const availableY = Math.max(1, stageRect.height - rect.height);
    const x = clamp(parseFloat(element.style.left) || 0, 0, availableX) / availableX;
    const y = clamp(parseFloat(element.style.top) || 0, 0, availableY) / availableY;
    localStorage.setItem(`novaPosition:v21:${element.id}`, JSON.stringify({ x, y }));
  }

  function placeCharacter(element, fallback) {
    const stageRect = stage.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    const maxX = Math.max(0, stageRect.width - rect.width);
    const maxY = Math.max(0, stageRect.height - rect.height);
    let position = null;
    try { position = JSON.parse(localStorage.getItem(`novaPosition:v21:${element.id}`)); } catch (_) { position = null; }
    let left;
    let top;
    if (position && Number.isFinite(position.x) && Number.isFinite(position.y)) {
      left = position.x * maxX;
      top = position.y * maxY;
    } else {
      const ownerWidth = owner.getBoundingClientRect().width;
      const catWidth = cat.getBoundingClientRect().width;
      const robotWidth = robot.getBoundingClientRect().width;
      const availableSpace = stageRect.width - ownerWidth - catWidth - robotWidth;
      const characterGap = clamp(availableSpace / 4, 4, 24);
      const clusterWidth = ownerWidth + catWidth + robotWidth + characterGap * 2;
      const clusterLeft = Math.max(4, (stageRect.width - clusterWidth) / 2);
      if (element === owner) left = clusterLeft;
      else if (element === cat) left = clusterLeft + ownerWidth + characterGap;
      else left = clusterLeft + ownerWidth + characterGap + catWidth + characterGap;
      top = clamp(maxY - fallback.bottom, 2, maxY);
    }
    element.style.left = `${clamp(left, 2, maxX - 2)}px`;
    element.style.top = `${clamp(top, 2, maxY - 2)}px`;
  }

  function makeDraggable(element, onTap) {
    let state = null;
    element.addEventListener('pointerdown', (event) => {
      if (event.button !== undefined && event.button !== 0) return;
      const elementRect = element.getBoundingClientRect();
      state = {
        id: event.pointerId,
        offsetX: event.clientX - elementRect.left,
        offsetY: event.clientY - elementRect.top,
        startX: event.clientX,
        startY: event.clientY,
        moved: false
      };
      element.setPointerCapture(event.pointerId);
      element.classList.add('dragging');
    });

    element.addEventListener('pointermove', (event) => {
      if (!state || event.pointerId !== state.id) return;
      const stageRect = stage.getBoundingClientRect();
      const elementRect = element.getBoundingClientRect();
      const distance = Math.hypot(event.clientX - state.startX, event.clientY - state.startY);
      if (distance > 5) state.moved = true;
      if (!state.moved) return;
      event.preventDefault();
      const left = clamp(event.clientX - stageRect.left - state.offsetX, 2, stageRect.width - elementRect.width - 2);
      const top = clamp(event.clientY - stageRect.top - state.offsetY, 2, stageRect.height - elementRect.height - 2);
      element.style.left = `${left}px`;
      element.style.top = `${top}px`;
    });

    const end = (event) => {
      if (!state || event.pointerId !== state.id) return;
      const moved = state.moved;
      state = null;
      element.classList.remove('dragging');
      try { element.releasePointerCapture(event.pointerId); } catch (_) { /* already released */ }
      if (moved) {
        saveCharacterPosition(element);
        dragHint.style.opacity = '0';
      } else {
        onTap();
      }
    };
    element.addEventListener('pointerup', end);
    element.addEventListener('pointercancel', end);
    element.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onTap();
      }
    });
  }

  makeDraggable(robot, () => {
    resetPerformance();
    respond(t('robot.tap'));
  });
  makeDraggable(owner, () => {
    resetPerformance();
    respond(t('owner.tap'), { character: 'owner', pitch: 0.82, rate: 0.91 });
  });
  makeDraggable(cat, performCatScene);

  function repositionCharacters() {
    placeCharacter(owner, { bottom: 5 });
    placeCharacter(robot, { bottom: 5 });
    placeCharacter(cat, { bottom: 5 });
  }

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    updateKeyboardLift();
    const width = Math.round(window.innerWidth || root.clientWidth);
    if (Math.abs(width - stableViewportWidth) < 40) return;
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      lockStableViewport(true);
      measureExpandedPanel();
      repositionCharacters();
    }, 160);
  });
  window.addEventListener('orientationchange', () => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      lockStableViewport(true);
      measureExpandedPanel();
      repositionCharacters();
    }, 420);
  });
  window.visualViewport?.addEventListener('resize', updateKeyboardLift);
  window.visualViewport?.addEventListener('scroll', updateKeyboardLift);
  input.addEventListener('focus', updateKeyboardLift);
  input.addEventListener('blur', () => window.setTimeout(updateKeyboardLift, 50));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (recognitionActive) {
        try { recognition?.abort(); } catch (_) { /* already stopped */ }
      }
    } else if (micWanted) {
      maybeRestartRecognition(450);
    }
  });
  window.addEventListener('pagehide', () => stopMicrophone(false));

  applyLanguage(false);
  addMessage('bot', visitorName ? t('chat.welcomeNamed', { name: visitorName }) : t('chat.welcome'));
  requestAnimationFrame(() => {
    measureExpandedPanel();
    repositionCharacters();
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./service-worker.js?v=26.1.0')
        .then((registration) => registration.update())
        .catch(() => {});
    });
  }

  window.NOVA_TEST = {
    version: VERSION,
    get language() { return language; },
    get micWanted() { return micWanted; },
    get panelCollapsed() { return panelCollapsed; },
    get compassHeading() { return compassHeading; },
    get compassZoomed() { return compassZoomed; },
    get brainStatus() { return brain?.getStatus?.() || null; },
    get lessonOpen() { return lessonState.open; },
    get lessonIndex() { return lessonState.index; },
    get lessonScore() { return lessonState.correct.size; },
    get lessonItem() { return currentEnglishLessonItem(); },
    get lastBotMessage() {
      const messages = chat.querySelectorAll('.message.bot .bubble');
      return messages.length ? messages[messages.length - 1].textContent : '';
    },
    runAction,
    setLanguage,
    setPanelCollapsed,
    enableCompass,
    handleCompassOrientation,
    handleUserText,
    cleanSpeechText,
    solveMathQuestion,
    startEnglishLesson,
    startEnglishLessonQuiz,
    checkEnglishLessonAnswer,
    nextEnglishLessonItem,
    closeEnglishLesson,
    answerKnowledgeQuestion,
    askAgent,
    activateLocalBrain
  };
})();
