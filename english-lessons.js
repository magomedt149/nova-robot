(() => {
  'use strict';

  // Practical American English for daily life and delivery work.
  window.NovaEnglishLessons = Object.freeze([
    { en: 'Hello', phonetic: 'хэ-ЛОУ', ru: 'Привет', example: 'Hello, how are you?', exampleRu: 'Привет, как дела?' },
    { en: 'Thank you', phonetic: 'СЭНК ю', ru: 'Спасибо', example: 'Thank you for your help.', exampleRu: 'Спасибо за помощь.' },
    { en: 'Please', phonetic: 'плиз', ru: 'Пожалуйста', example: 'Please wait here.', exampleRu: 'Пожалуйста, подождите здесь.' },
    { en: 'Excuse me', phonetic: 'ик-СКЬЮЗ ми', ru: 'Извините', example: 'Excuse me, can I ask a question?', exampleRu: 'Извините, можно задать вопрос?' },
    { en: "I don't understand", phonetic: 'ай ДОУНТ андэр-СТЭНД', ru: 'Я не понимаю', example: "Sorry, I don't understand.", exampleRu: 'Извините, я не понимаю.', answers: ['i do not understand'] },
    { en: 'Could you repeat that?', phonetic: 'куд ю ри-ПИТ зэт', ru: 'Можете повторить?', example: 'Could you repeat that, please?', exampleRu: 'Можете повторить, пожалуйста?' },
    { en: 'Speak slowly, please', phonetic: 'спик СЛОУ-ли плиз', ru: 'Говорите медленнее, пожалуйста', example: 'Please speak slowly.', exampleRu: 'Пожалуйста, говорите медленнее.', answers: ['please speak slowly'] },
    { en: 'What does this mean?', phonetic: 'уот даз зис мин', ru: 'Что это значит?', example: 'What does this word mean?', exampleRu: 'Что означает это слово?' },
    { en: 'How do you say this in English?', phonetic: 'хау ду ю сэй зис ин ИН-глиш', ru: 'Как это сказать по-английски?', example: 'How do you say this in English?', exampleRu: 'Как это сказать по-английски?' },
    { en: 'Can you help me?', phonetic: 'кэн ю хэлп ми', ru: 'Можете мне помочь?', example: 'Can you help me find this address?', exampleRu: 'Можете помочь найти этот адрес?' },

    { en: "I'm on my way", phonetic: 'айм он май уэй', ru: 'Я уже еду', example: "I'm on my way now.", exampleRu: 'Я уже еду.', answers: ['i am on my way'] },
    { en: 'I have arrived', phonetic: 'ай хэв э-РАЙВД', ru: 'Я приехал', example: 'Hello, I have arrived.', exampleRu: 'Здравствуйте, я приехал.' },
    { en: 'I have your order', phonetic: 'ай хэв йор ОР-дэр', ru: 'У меня ваш заказ', example: 'Hi, I have your order.', exampleRu: 'Здравствуйте, у меня ваш заказ.' },
    { en: 'I left it at the door', phonetic: 'ай лэфт ит эт зэ дор', ru: 'Я оставил у двери', example: 'Your order is here. I left it at the door.', exampleRu: 'Ваш заказ здесь. Я оставил его у двери.' },
    { en: 'Could you send the gate code?', phonetic: 'куд ю сэнд зэ гейт коуд', ru: 'Можете прислать код от ворот?', example: 'Could you send the gate code, please?', exampleRu: 'Можете прислать код от ворот, пожалуйста?' },
    { en: 'Which apartment is it?', phonetic: 'уич э-ПАРТ-мэнт из ит', ru: 'Какая это квартира?', example: 'Which apartment is it?', exampleRu: 'Какая это квартира?' },
    { en: 'The restaurant is still preparing your order', phonetic: 'зэ РЭС-тэ-рант из стил при-ПЭ-ринг йор ОР-дэр', ru: 'Ресторан ещё готовит ваш заказ', example: 'The restaurant is still preparing your order.', exampleRu: 'Ресторан ещё готовит ваш заказ.' },
    { en: 'Thank you for your patience', phonetic: 'СЭНК ю фор йор ПЭЙ-шэнс', ru: 'Спасибо за ваше терпение', example: 'Thank you for your patience. I will be there soon.', exampleRu: 'Спасибо за терпение. Я скоро буду.' },
    { en: 'Have a great day', phonetic: 'хэв э грейт дэй', ru: 'Хорошего дня', example: 'Thank you. Have a great day!', exampleRu: 'Спасибо. Хорошего дня!' },
    { en: 'Drive safely', phonetic: 'драйв СЭЙФ-ли', ru: 'Ведите машину осторожно', example: 'Drive safely and see you soon.', exampleRu: 'Будьте осторожны за рулём, до встречи.' },

    { en: 'Address', phonetic: 'э-ДРЭС', ru: 'Адрес', example: 'Please check the address.', exampleRu: 'Пожалуйста, проверьте адрес.' },
    { en: 'Customer', phonetic: 'КАС-тэ-мэр', ru: 'Клиент', example: 'The customer is waiting outside.', exampleRu: 'Клиент ждёт снаружи.' },
    { en: 'Order', phonetic: 'ОР-дэр', ru: 'Заказ', example: 'Your order is ready.', exampleRu: 'Ваш заказ готов.' },
    { en: 'Entrance', phonetic: 'ЭН-трэнс', ru: 'Вход', example: 'The entrance is on the left.', exampleRu: 'Вход находится слева.' },
    { en: 'Receipt', phonetic: 'ри-СИТ', ru: 'Чек', example: 'Do you need a receipt?', exampleRu: 'Вам нужен чек?' },
    { en: 'Change', phonetic: 'чэйндж', ru: 'Сдача; изменение', example: 'Do you have change?', exampleRu: 'У вас есть сдача?' },
    { en: 'Cash', phonetic: 'кэш', ru: 'Наличные', example: 'I can pay with cash.', exampleRu: 'Я могу заплатить наличными.' },
    { en: 'Card', phonetic: 'кард', ru: 'Карта', example: 'Can I pay by card?', exampleRu: 'Можно оплатить картой?' },
    { en: 'Nearby', phonetic: 'нир-БАЙ', ru: 'Рядом, поблизости', example: 'Is there a gas station nearby?', exampleRu: 'Поблизости есть заправка?' },
    { en: 'Far', phonetic: 'фар', ru: 'Далеко', example: 'Is it far from here?', exampleRu: 'Это далеко отсюда?' },

    { en: 'Today', phonetic: 'ту-ДЭЙ', ru: 'Сегодня', example: 'I am working today.', exampleRu: 'Я сегодня работаю.' },
    { en: 'Tomorrow', phonetic: 'ту-МО-роу', ru: 'Завтра', example: 'I have an appointment tomorrow.', exampleRu: 'У меня завтра встреча.' },
    { en: 'Morning', phonetic: 'МОР-нинг', ru: 'Утро', example: 'Good morning!', exampleRu: 'Доброе утро!' },
    { en: 'Evening', phonetic: 'ИВ-нинг', ru: 'Вечер', example: 'I will call you this evening.', exampleRu: 'Я позвоню вам сегодня вечером.' },
    { en: 'Ready', phonetic: 'РЭ-ди', ru: 'Готов', example: 'I am ready to go.', exampleRu: 'Я готов ехать.' },
    { en: 'Busy', phonetic: 'БИ-зи', ru: 'Занят', example: 'I am busy right now.', exampleRu: 'Я сейчас занят.' },
    { en: 'Available', phonetic: 'э-ВЭЙ-лэ-бэл', ru: 'Свободен; доступен', example: 'Are you available tomorrow?', exampleRu: 'Вы свободны завтра?' },
    { en: 'Appointment', phonetic: 'э-ПОЙНТ-мэнт', ru: 'Запись; назначенная встреча', example: 'I have a doctor appointment.', exampleRu: 'Я записан к врачу.' },
    { en: 'Open', phonetic: 'ОУ-пэн', ru: 'Открыто', example: 'Is the store open?', exampleRu: 'Магазин открыт?' },
    { en: 'Closed', phonetic: 'клоузд', ru: 'Закрыто', example: 'The restaurant is closed.', exampleRu: 'Ресторан закрыт.' },

    { en: 'I need a doctor', phonetic: 'ай нид э ДОК-тэр', ru: 'Мне нужен врач', example: 'I need a doctor, please.', exampleRu: 'Мне нужен врач, пожалуйста.' },
    { en: 'I am in pain', phonetic: 'ай эм ин пэйн', ru: 'У меня болит', example: 'I am in pain and need help.', exampleRu: 'У меня болит, и мне нужна помощь.' },
    { en: 'Medicine', phonetic: 'МЭ-дэ-син', ru: 'Лекарство', example: 'When should I take this medicine?', exampleRu: 'Когда мне принимать это лекарство?' },
    { en: 'Insurance', phonetic: 'ин-ШУ-рэнс', ru: 'Страховка', example: 'Here is my insurance card.', exampleRu: 'Вот моя страховая карта.' },
    { en: 'I had surgery', phonetic: 'ай хэд СЁР-джэ-ри', ru: 'У меня была операция', example: 'I had surgery last month.', exampleRu: 'В прошлом месяце у меня была операция.' },
    { en: 'Call me, please', phonetic: 'кол ми плиз', ru: 'Позвоните мне, пожалуйста', example: 'Call me when you arrive, please.', exampleRu: 'Позвоните мне, когда приедете, пожалуйста.' },
    { en: 'Text me, please', phonetic: 'тэкст ми плиз', ru: 'Напишите мне, пожалуйста', example: 'Text me the address, please.', exampleRu: 'Пришлите мне адрес сообщением, пожалуйста.' },
    { en: 'My car has a problem', phonetic: 'май кар хэз э ПРОБ-лэм', ru: 'У моей машины проблема', example: 'My car has a problem. I need help.', exampleRu: 'У моей машины проблема. Мне нужна помощь.' },
    { en: 'I need gas', phonetic: 'ай нид гэс', ru: 'Мне нужен бензин', example: 'I need gas. Where is the nearest station?', exampleRu: 'Мне нужен бензин. Где ближайшая заправка?' },
    { en: 'The battery is low', phonetic: 'зэ БЭ-тэ-ри из лоу', ru: 'Батарея разряжена', example: 'My phone battery is low.', exampleRu: 'Батарея моего телефона разряжена.' }
  ]);
})();
