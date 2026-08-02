const express = require('express');
const router = express.Router();
const { getDB } = require('../config/db');

// ============================================================
// AI CHAT — ULTRA COMPREHENSIVE SMART AUTO-REPLY ENGINE
// ============================================================

// ========== DEFAULT FALLBACK RESPONSES (Multilingual) ==========
const FALLBACK_RESPONSES = {
    en: "I'm sorry, I didn't quite understand that. Please contact 24/7 support or type 'help' for a list of services.",
    hi: "मुझे क्षमा करें, मैं वह समझ नहीं पाया। कृपया 24/7 सहायता से संपर्क करें या सेवाओं की सूची के लिए 'help' टाइप करें।",
    ar: "آسف، لم أفهم ذلك تمامًا. يرجى الاتصال بالدعم 24/7 أو اكتب 'help' للحصول على قائمة الخدمات."
};

// ========== BUILT-IN SMART KEYWORD MATCHING (MASSIVELY EXPANDED) ==========
const SMART_KEYWORDS = {
    // ============================================================
    // 1. GREETINGS & FAREWELLS
    // ============================================================
    'hi|hello|hey|good morning|good evening|good afternoon|namaste|salam|aoa': {
        en: "Hello! Welcome to our hotel. How can I assist you today?",
        hi: "नमस्ते! हमारे होटल में आपका स्वागत है। आज मैं आपकी कैसे सहायता कर सकता हूँ?",
        ar: "مرحباً! أهلاً بك في فندقنا. كيف يمكنني مساعدتك اليوم؟"
    },
    'bye|goodbye|see you|thank you|thanks|shukriya|dhanyavad': {
        en: "Thank you for staying with us. Have a wonderful day and a safe journey!",
        hi: "हमारे साथ रहने के लिए धन्यवाद। आपका दिन शुभ हो और सफर सुरक्षित रहे!",
        ar: "شكراً لإقامتك معنا. أتمنى لك يوماً رائعاً ورحلة آمنة!"
    },

    // ============================================================
    // 2. PAYMENTS, BILLING & DEPOSITS
    // ============================================================
    'bill|payment|invoice|gst|receipt|pay|balance|amount due': {
        en: "You can check your bill and payment details in the Payments section. Would you like me to fetch your current balance?",
        hi: "आप अपना बिल और भुगतान विवरण भुगतान अनुभाग में देख सकते हैं। क्या आप चाहते हैं कि मैं आपका वर्तमान बैलेंस बताऊँ?",
        ar: "يمكنك التحقق من تفاصيل الفاتورة والدفع في قسم المدفوعات. هل تريد مني جلب رصيدك الحالي؟"
    },
    'deposit|security money|refund|deposit return|hold amount': {
        en: "Security deposits are typically refunded within 3-5 working days after checkout, subject to a satisfactory room inspection.",
        hi: "सुरक्षा जमा राशि चेकआउट के बाद कमरे की संतोषजनक जाँच के अधीन, आमतौर पर 3-5 कार्यदिवसों के भीतर वापस कर दी जाती है।",
        ar: "يتم عادةً رد الودائع الأمنية خلال 3-5 أيام عمل بعد تسجيل المغادرة، خاضعة لفحص مرضي للغرفة."
    },
    'extra person charge|additional guest fee': {
        en: "Additional guest charges apply as per hotel policy. Please contact reception for the exact amount.",
        hi: "होटल नीति के अनुसार अतिरिक्त मेहमान शुल्क लागू होता है। सटीक राशि के लिए कृपया रिसेप्शन से संपर्क करें।",
        ar: "تطبق رسوم الضيوف الإضافيين وفقاً لسياسة الفندق. يرجى الاتصال بالمكتب الأمامي للحصول على المبلغ الدقيق."
    },

    // ============================================================
    // 3. WIFI, INTERNET & TECH SUPPORT
    // ============================================================
    'wifi|internet|password|network|connect|wi-fi': {
        en: "WiFi Network: Hotel_Guest | Password: Welcome2024. You can also find this printed on your room key card folder.",
        hi: "वाईफाई नेटवर्क: Hotel_Guest | पासवर्ड: Welcome2024। आप इसे अपने कमरे की की कार्ड फोल्डर पर मुद्रित भी पा सकते हैं।",
        ar: "شبكة الواي فاي: Hotel_Guest | كلمة المرور: Welcome2024. يمكنك أيضاً العثور على هذا مطبوعاً على مجلد مفتاح غرفتك."
    },
    'wifi not working|slow internet|no connection': {
        en: "Please try disconnecting and reconnecting to the WiFi. If the issue persists, our IT team can be dispatched to your room.",
        hi: "कृपया वाईफाई को डिस्कनेक्ट करके फिर से कनेक्ट करने का प्रयास करें। यदि समस्या बनी रहती है, तो हमारी आईटी टीम आपके कमरे में भेजी जा सकती है।",
        ar: "يرجى محاولة قطع الاتصال وإعادة الاتصال بالواي فاي. إذا استمرت المشكلة، يمكن إرسال فريق تكنولوجيا المعلومات لدينا إلى غرفتك."
    },
    'bluetooth|hdmi cable|usb charging|cast to tv|smart tv': {
        en: "Our rooms are equipped with Smart TVs supporting screen casting. HDMI cables and USB chargers are available at the reception.",
        hi: "हमारे कमरे स्क्रीन कास्टिंग का समर्थन करने वाले स्मार्ट टीवी से लैस हैं। एचडीएमआई केबल और यूएसबी चार्जर रिसेप्शन पर उपलब्ध हैं।",
        ar: "غرفنا مجهزة بتلفزيونات ذكية تدعم عرض الشاشة. تتوفر كابلات HDMI وشواحن USB في المكتب الأمامي."
    },

    // ============================================================
    // 4. CHECK-IN, CHECK-OUT & ROOM ACCESS
    // ============================================================
    'checkout|check out|departure|leaving|checkout time': {
        en: "Standard checkout time is 12:00 PM. You can complete checkout from the app or visit the reception.",
        hi: "मानक चेकआउट समय दोपहर 12:00 बजे है। आप ऐप से चेकआउट पूरा कर सकते हैं या रिसेप्शन पर जा सकते हैं।",
        ar: "وقت تسجيل المغادرة القياسي هو 12:00 ظهراً. يمكنك إكمال المغادرة من التطبيق أو زيارة المكتب الأمامي."
    },
    'check in|check-in|arrival|arrive|early check in': {
        en: "Standard check-in time is 2:00 PM. Early check-in is subject to room availability and may incur a nominal fee.",
        hi: "मानक चेक-इन समय दोपहर 2:00 बजे है। अर्ली चेक-इन कमरे की उपलब्धता के अधीन है और इस पर नाममात्र शुल्क लग सकता है।",
        ar: "وقت تسجيل الوصول القياسي هو 2:00 ظهراً. تسجيل الوصول المبكر يخضع لتوفر الغرفة وقد يتكلف رسوماً رمزية."
    },
    'late checkout|extend stay|extension|stay longer': {
        en: "Late checkout is subject to availability and may incur an additional half-day charge. Please request this at reception.",
        hi: "लेट चेकआउट उपलब्धता के अधीन है और इस पर अतिरिक्त आधा दिन का शुल्क लग सकता है। कृपया यह अनुरोध रिसेप्शन पर करें।",
        ar: "تسجيل المغادرة المتأخر يخضع للتوفر وقد يتكلف رسوماً إضافية لنصف يوم. يرجى طلب ذلك من المكتب الأمامي."
    },
    'key card|room key|door not opening|lock|lost key|magnetic card': {
        en: "If your key card is not working or is lost, please visit the reception immediately for a replacement or reprogramming.",
        hi: "यदि आपकी की कार्ड काम नहीं कर रही है या खो गई है, तो प्रतिस्थापन या रिप्रोग्रामिंग के लिए कृपया तुरंत रिसेप्शन पर जाएं।",
        ar: "إذا كانت بطاقة المفتاح لا تعمل أو فقدت، يرجى زيارة المكتب الأمامي فوراً للحصول على بديل أو إعادة برمجة."
    },

    // ============================================================
    // 5. ROOM SERVICE, DINING & DIETARY REQUIREMENTS
    // ============================================================
    'room service|order food|food delivery|dining|hungry|menu': {
        en: "Room service is available 24/7. Please use the 'Services' section in the app to view the menu and place your order.",
        hi: "रूम सर्विस 24/7 उपलब्ध है। कृपया मेनू देखने और ऑर्डर देने के लिए ऐप में 'Services' अनुभाग का उपयोग करें।",
        ar: "خدمة الغرف متاحة 24/7. يرجى استخدام قسم 'الخدمات' في التطبيق لعرض القائمة وتقديم طلبك."
    },
    'breakfast|breakfast time|morning food|complimentary breakfast': {
        en: "Complimentary breakfast is served from 7:00 AM to 10:30 AM in the main restaurant. In-room breakfast is also available.",
        hi: "कॉम्प्लीमेंटरी नाश्ता मुख्य रेस्तरां में सुबह 7:00 बजे से 10:30 बजे तक परोसा जाता है। इन-रूम नाश्ता भी उपलब्ध है।",
        ar: "يتم تقديم الإفطار المجاني من الساعة 7:00 صباحاً حتى 10:30 صباحاً في المطعم الرئيسي. يتوفر أيضاً الإفطار في الغرفة."
    },
    'halal|pork|alcohol|non veg|vegetarian|vegan|jain food': {
        en: "We offer a wide variety of Halal, Vegetarian, and Vegan options. Please inform room service of any dietary restrictions or allergies.",
        hi: "हम हलाल, शाकाहारी और वेगन विकल्पों की एक विस्तृत श्रृंखला प्रदान करते हैं। कृपया रूम सर्विस को किसी भी आहार प्रतिबंध या एलर्जी के बारे में बताएं।",
        ar: "نحن نقدم مجموعة واسعة من الخيارات الحلال والنباتية. يرجى إبلاغ خدمة الغرفة بأي قيود غذائية أو حساسية."
    },
    'gluten free|nut allergy|dairy free|food allergy': {
        en: "Our culinary team can accommodate most food allergies. Please specify your allergy when ordering, and we will ensure a safe meal.",
        hi: "हमारी पाक टीम अधिकांश खाद्य एलर्जी को समायोजित कर सकती है। कृपया ऑर्डर करते समय अपनी एलर्जी निर्दिष्ट करें, और हम एक सुरक्षित भोजन सुनिश्चित करेंगे।",
        ar: "يمكن لفريق الطهي لدينا استيعاب معظم حساسيات الطعام. يرجى تحديد حساسيتك عند الطلب، وسنضمن وجبة آمنة."
    },
    'minibar|fridge|snacks in room|drinks in room|complimentary water': {
        en: "The minibar is stocked with beverages and snacks. Two complimentary water bottles are provided daily. Other items are chargeable.",
        hi: "मिनीबार पेय और नाश्ते से भरा हुआ है। प्रतिदिन दो कॉम्प्लीमेंटरी पानी की बोतलें प्रदान की जाती हैं। अन्य वस्तुएँ चार्जेबल हैं।",
        ar: "الميني بار مليء بالمشروبات والوجبات الخفيفة. يتم توفير زجاجتين من الماء المجاني يومياً. العناصر الأخرى تخضع للرسوم."
    },
    'coffee machine|kettle|tea|coffee': {
        en: "A coffee/tea making facility with complimentary sachets is available in your room. Additional supplies can be requested from housekeeping.",
        hi: "आपके कमरे में कॉम्प्लीमेंटरी सैशेट के साथ कॉफी/चाय बनाने की सुविधा उपलब्ध है। अतिरिक्त सामग्री हाउसकीपिंग से अनुरोध की जा सकती है।",
        ar: "تتوفر مرافق صنع القهوة/الشاي مع أكياس مجانية في غرفتك. يمكن طلب إمدادات إضافية من خدمة التدبير المنزلي."
    },

    // ============================================================
    // 6. HOUSEKEEPING & ROOM AMENITIES
    // ============================================================
    'housekeeping|cleaning|room clean|towel|pillow|blanket|extra bed': {
        en: "Housekeeping can be requested anytime from the 'Services' section. We will send someone to your room shortly.",
        hi: "हाउसकीपिंग कभी भी 'Services' अनुभाग से अनुरोध की जा सकती है। हम जल्द ही किसी को आपके कमरे में भेजेंगे।",
        ar: "يمكن طلب خدمة التدبير المنزلي في أي وقت من قسم 'الخدمات'. سنرسل شخصاً إلى غرفتك قريباً."
    },
    'ac not working|tv not working|hot water|no water|leak|broken|bulb': {
        en: "We're sorry for the inconvenience. I have immediately notified our maintenance team to visit your room and resolve the issue.",
        hi: "असुविधा के लिए हमें खेद है। मैंने तुरंत हमारी मेंटेनेंस टीम को आपके कमरे में आने और समस्या को हल करने के लिए सूचित कर दिया है।",
        ar: "نأسف على الإزعاج. لقد قمت بإخطار فريق الصيانة فوراً لزيارة غرفتك وحل المشكلة."
    },
    'iron|hair dryer|kettle|adapter|extension board|hanger|slippers|bathrobe': {
        en: "These amenities are available on request. Please raise a request in the 'Services' section, and we will deliver it to your room within 15 minutes.",
        hi: "ये सुविधाएँ अनुरोध पर उपलब्ध हैं। कृपया 'Services' अनुभाग में अनुरोध करें, और हम इसे 15 मिनट के भीतर आपके कमरे में पहुँचा देंगे।",
        ar: "هذه وسائل الراحة متاحة عند الطلب. يرجى تقديم طلب في قسم 'الخدمات'، وسنقوم بتوصيله إلى غرفتك خلال 15 دقيقة."
    },
    'safe box|locker|password|how to use safe': {
        en: "The in-room safe can be operated using your room number as the default password. If locked, please contact reception for assistance.",
        hi: "इन-रूम सेफ का संचालन डिफ़ॉल्ट पासवर्ड के रूप में आपके कमरे का नंबर उपयोग करके किया जा सकता है। यदि लॉक हो गया है, तो सहायता के लिए रिसेप्शन से संपर्क करें।",
        ar: "يمكن تشغيل الخزنة في الغرفة باستخدام رقم غرفتك ككلمة مرور افتراضية. إذا تم قفلها، يرجى الاتصال بالمكتب الأمامي للمساعدة."
    },
    'toiletries|shampoo|soap|toothbrush|razor|sewing kit|sanitary pads': {
        en: "Complimentary toiletries are provided in the bathroom. Additional items like toothbrushes or razors can be requested from housekeeping.",
        hi: "बाथरूम में कॉम्प्लीमेंटरी टॉयलेटरीज़ प्रदान की जाती हैं। टूथब्रश या रेज़र जैसे अतिरिक्त आइटम हाउसकीपिंग से अनुरोध किए जा सकते हैं।",
        ar: "توفر أدوات الزينة المجانية في الحمام. يمكن طلب عناصر إضافية مثل فرش الأسنان أو شفرات الحلاقة من خدمة التدبير المنزلي."
    },

    // ============================================================
    // 7. LAUNDRY & DRY CLEANING
    // ============================================================
    'laundry|wash|dry clean|ironing|pressing|when will clothes come': {
        en: "Laundry and dry cleaning services are available. Clothes submitted before 9:00 AM are usually returned by 6:00 PM the same day.",
        hi: "लॉन्ड्री और ड्राई क्लीनिंग सेवाएँ उपलब्ध हैं। सुबह 9:00 बजे से पहले जमा किए गए कपड़े आमतौर पर उसी दिन शाम 6:00 बजे तक वापस कर दिए जाते हैं।",
        ar: "خدمات الغسيل والتنظيف الجاف متاحة. الملابس المقدمة قبل الساعة 9:00 صباحاً تُعاد عادةً بحلول الساعة 6:00 مساءً من نفس اليوم."
    },
    'express laundry|urgent washing|same day laundry': {
        en: "Express laundry service is available at a 50% surcharge, with a 4-hour turnaround time.",
        hi: "एक्सप्रेस लॉन्ड्री सेवा 50% अतिरिक्त शुल्क पर उपलब्ध है, जिसका टर्नअराउंड समय 4 घंटे है।",
        ar: "تتوفر خدمة الغسيل السريع برسوم إضافية بنسبة 50٪، مع وقت تسليم خلال 4 ساعات."
    },
    'shoe shine|shoe cleaning': {
        en: "Complimentary shoe shine service is available. Please place your shoes in the shoe shine bag provided in the closet.",
        hi: "कॉम्प्लीमेंटरी शू शॉइन सेवा उपलब्ध है। कृपया अपने जूते क्लॉसेट में प्रदान किए गए शू शॉइन बैग में रख दें।",
        ar: "تتوفر خدمة تلميع الأحذية المجانية. يرجى وضع أحذيتك في حقيبة تلميع الأحذية المتوفرة في الخزانة."
    },

    // ============================================================
    // 8. AMENITIES & FACILITIES
    // ============================================================
    'pool|swimming|swim|pool time|kids pool': {
        en: "The swimming pool is open daily from 7:00 AM to 8:00 PM. Pool towels are available at the poolside. Children must be accompanied by an adult.",
        hi: "स्विमिंग पूल प्रतिदिन सुबह 7:00 बजे से शाम 8:00 बजे तक खुला रहता है। पूल तौलिये पूल के पास उपलब्ध हैं। बच्चों को एक वयस्क के साथ होना चाहिए।",
        ar: "المسبح مفتوح يومياً من الساعة 7:00 صباحاً حتى 8:00 مساءً. تتوفر مناشف المسبح على جانب المسبح. يجب أن يكون الأطفال بصحبة بالغ."
    },
    'gym|fitness|workout|exercise|fitness center|treadmill|yoga mat': {
        en: "Our fitness center is open 24/7 for hotel guests. Please wear appropriate athletic footwear. Yoga mats and towels are provided.",
        hi: "हमारा फिटनेस सेंटर होटल के मेहमानों के लिए 24/7 खुला है। कृपया उचित एथलेटिक जूते पहनें। योगा मैट और तौलिये प्रदान किए जाते हैं।",
        ar: "مركز اللياقة البدنية لدينا مفتوح 24/7 لنزلاء الفندق. يرجى ارتداء أحذية رياضية مناسبة. يتم توفير سجاد اليوجا والمناشف."
    },
    'spa|massage|wellness|relax|sauna|steam|spa price': {
        en: "Spa and wellness services can be booked from the 'Services' section. Advance booking is highly recommended due to high demand.",
        hi: "स्पा और वेलनेस सेवाएँ 'Services' अनुभाग से बुक की जा सकती हैं। उच्च मांग के कारण पूर्व बुकिंग की अत्यधिक अनुशंसा की जाती है।",
        ar: "يمكن حجز خدمات السبا والعافية من قسم 'الخدمات'. يوصى بشدة بالحجز المسبق بسبب الطلب العالي."
    },
    'parking|valet|car park|ev charging|electric car|parking fee': {
        en: "Complimentary self-parking is available for guests. Valet parking and EV charging stations are available at an additional charge.",
        hi: "मेहमानों के लिए कॉम्प्लीमेंटरी सेल्फ-पार्किंग उपलब्ध है। वेलट पार्किंग और ईवी चार्जिंग स्टेशन अतिरिक्त शुल्क पर उपलब्ध हैं।",
        ar: "موقف السيارات الذاتي المجاني متاح للنزلاء. تتوفر خدمة صف السيارات ومحطات شحن السيارات الكهربائية برسوم إضافية."
    },
    'business center|business|work|office|print|scan|fax|photocopy': {
        en: "Our business center offers printing, scanning, and fax services. It is located on the Ground Floor and is open from 8:00 AM to 8:00 PM.",
        hi: "हमारा बिजनेस सेंटर प्रिंटिंग, स्कैनिंग और फैक्स सेवाएँ प्रदान करता है। यह ग्राउंड फ्लोर पर स्थित है और सुबह 8:00 बजे से रात 8:00 बजे तक खुला रहता है।",
        ar: "يوفر مركز الأعمال لدينا خدمات الطباعة والمسح الضوئي والفاكس. يقع في الطابق الأرضي وهو مفتوح من الساعة 8:00 صباحاً حتى 8:00 مساءً."
    },
    'meeting room|conference|banquet|event|projector|capacity': {
        en: "We have fully equipped meeting rooms. Please contact the events team at reception for capacity details and booking.",
        hi: "हमारे पास पूरी तरह से सुसज्जित मीटिंग रूम हैं। क्षमता विवरण और बुकिंग के लिए कृपया रिसेप्शन पर इवेंट्स टीम से संपर्क करें।",
        ar: "لدينا غرف اجتماعات مجهزة بالكامل. يرجى الاتصال بفريق الفعاليات في المكتب الأمامي للحصول على تفاصيل السعة والحجز."
    },

    // ============================================================
    // 9. TRANSPORTATION & LOCAL AREA
    // ============================================================
    'taxi|cab|transport|airport pickup|airport drop|uber|ola|shuttle': {
        en: "We can arrange airport transfers and local taxis. Please provide your flight details or destination at the reception.",
        hi: "हम एयरपोर्ट ट्रांसफर और स्थानीय टैक्सी की व्यवस्था कर सकते हैं। कृपया रिसेप्शन पर अपनी फ्लाइट विवरण या गंतव्य प्रदान करें।",
        ar: "يمكننا ترتيب نقل المطار وسيارات الأجرة المحلية. يرجى تقديم تفاصيل رحلتك أو وجهتك في المكتب الأمامي."
    },
    'atm|cash machine|bank nearby|withdraw money|currency exchange': {
        en: "There is an ATM and currency exchange counter located in the hotel lobby. Several banks are within a 5-minute walking distance.",
        hi: "होटल लॉबी में एक एटीएम और मुद्रा विनिमय काउंटर स्थित है। कई बैंक 5 मिनट की पैदल दूरी के भीतर हैं।",
        ar: "يوجد صراف آلي وعداد صرف عملات في بهو الفندق. العديد من البنوك على بعد 5 دقائق سيراً على الأقدام."
    },
    'pharmacy|medicine|medical store|chemist|hospital nearby|clinic': {
        en: "A 24-hour pharmacy is located 2 minutes away from the hotel. For medical emergencies, please contact reception immediately.",
        hi: "होटल से 2 मिनट की दूरी पर एक 24 घंटे खुलने वाली फार्मेसी स्थित है। चिकित्सा आपात स्थिति के लिए, कृपया तुरंत रिसेप्शन से संपर्क करें।",
        ar: "توجد صيدلية تعمل على مدار 24 ساعة على بعد دقيقتين من الفندق. للطوارئ الطبية، يرجى الاتصال بالمكتب الأمامي فوراً."
    },
    'mosque|masjid|church|temple|worship place|qibla direction|prayer mat': {
        en: "We provide prayer mats in the room. The Qibla direction is indicated by an arrow on the ceiling. Nearby places of worship can be mapped by reception.",
        hi: "हम कमरे में नमाज चटाई प्रदान करते हैं। किबला की दिशा छत पर एक तीर से दर्शाई गई है। निकटतम पूजा स्थल की जानकारी रिसेप्शन से ली जा सकती है।",
        ar: "نوفر سجادات الصلاة في الغرفة. اتجاه القبلة موضح بسهم على السقف. يمكن للمكتب الأمامي تحديد أماكن العبادة القريبة."
    },
    'nearest mall|shopping|tourist places|metro|bus stop|sightseeing': {
        en: "The nearest shopping mall is 10 minutes away. The reception can provide a map of tourist attractions and arrange guided tours.",
        hi: "निकटतम शॉपिंग मॉल 10 मिनट की दूरी पर है। रिसेप्शन पर्यटक आकर्षणों का नक्शा प्रदान कर सकता है और गाइडेड टूर की व्यवस्था कर सकता है।",
        ar: "أقرب مركز تسوق يبعد 10 دقائق. يمكن للمكتب الأمامي توفير خريطة للمعالم السياحية وترتيب جولات إرشادية."
    },

    // ============================================================
    // 10. POLICIES & SPECIAL REQUESTS
    // ============================================================
    'pet policy|dog|cat|animal|pets allowed|pet fee': {
        en: "We are a pet-friendly hotel! Small pets are allowed with prior notice and a nominal cleaning fee. Please inform reception.",
        hi: "हम एक पेट-फ्रेंडली होटल हैं! पूर्व सूचना और नाममात्र की सफाई शुल्क के साथ छोटे पालतू जानवरों की अनुमति है। कृपया रिसेप्शन को सूचित करें।",
        ar: "نحن فندق صديق للحيوانات الأليفة! يُسمح بالحيوانات الأليفة الصغيرة مع إشعار مسبق ورسوم تنظيف رمزية. يرجى إبلاغ المكتب الأمامي."
    },
    'smoking|smoke|smoker|vape|smoking fine': {
        en: "This is a 100% non-smoking hotel. Smoking is only permitted in the designated outdoor smoking zones. Fines apply for smoking in rooms.",
        hi: "यह एक 100% नॉन-स्मोकिंग होटल है। धूम्रपान केवल निर्दिष्ट आउटडोर स्मोकिंग जोन में ही अनुमत है। कमरों में धूम्रपान पर जुर्माना लागू होता है।",
        ar: "هذا فندق لغير المدخنين بنسبة 100٪. يُسمح بالتدخين فقط في مناطق التدخين الخارجية المخصصة. تطبق غرامات على التدخين في الغرف."
    },
    'visitor|friend coming|guest visit|visitor policy|visitor fee': {
        en: "Visitors are welcome in the lobby and restaurant until 10:00 PM. For room visits, please register them at the reception for security purposes.",
        hi: "लॉबी और रेस्तरां में रात 10:00 बजे तक मेहमानों का स्वागत है। कमरे में आने वाले मेहमानों के लिए, कृपया सुरक्षा उद्देश्यों से उन्हें रिसेप्शन पर पंजीकृत करें।",
        ar: "نرحب بالزوار في البهو والمطعم حتى الساعة 10:00 مساءً. لزيارات الغرفة، يرجى تسجيلهم في المكتب الأمامي لأغراض أمنية."
    },
    'wake up|wakeup|morning call|alarm': {
        en: "You can schedule a wake-up call from the 'Services' section or by dialing '0' from your room phone.",
        hi: "आप 'Services' अनुभाग से या अपने कमरे के फोन से '0' डायल करके वेक-अप कॉल शेड्यूल कर सकते हैं।",
        ar: "يمكنك جدولة مكالمة إيقاظ من قسم 'الخدمات' أو عن طريق طلب '0' من هاتف غرفتك."
    },
    'luggage|baggage|storage|bag|suitcase|left luggage': {
        en: "Complimentary luggage storage is available at the concierge desk before check-in and after checkout.",
        hi: "चेक-इन से पहले और चेक-आउट के बाद कंसीयज डेस्क पर कॉम्प्लीमेंटरी सामान भंडारण उपलब्ध है।",
        ar: "يتوفر تخزين الأمتعة المجاني في مكتب الكونسيرج قبل تسجيل الوصول وبعد تسجيل المغادرة."
    },
    'lost|found|lost item|missing|forgot something': {
        en: "Please report lost items immediately to the reception or use the '24/7 Support' section in the app.",
        hi: "कृपया खोई हुई वस्तुओं की रिपोर्ट तुरंत रिसेप्शन को करें या ऐप में '24/7 Support' अनुभाग का उपयोग करें।",
        ar: "يرجى الإبلاغ عن العناصر المفقودة فوراً للمكتب الأمامي أو استخدام قسم 'الدعم 24/7' في التطبيق."
    },
    'wheelchair|accessible|disability|special needs|ground floor room': {
        en: "We have wheelchair-accessible rooms and facilities. Please contact reception to ensure your specific needs are met.",
        hi: "हमारे पास व्हीलचेयर सुलभ कमरे और सुविधाएँ हैं। कृपया यह सुनिश्चित करने के लिए रिसेप्शन से संपर्क करें कि आपकी विशिष्ट आवश्यकताएँ पूरी हों।",
        ar: "لدينا غرف ومرافق يمكن الوصول إليها بواسطة الكراسي المتحركة. يرجى الاتصال بالمكتب الأمامي لضمان تلبية احتياجاتك الخاصة."
    },
    'honeymoon|birthday|anniversary|special occasion|cake|flower|decoration': {
        en: "Congratulations! We can arrange special room decorations, cakes, or flowers. Please request this via the 'Services' section at least 24 hours in advance.",
        hi: "बधाई हो! हम विशेष कमरे की सजावट, केक या फूलों की व्यवस्था कर सकते हैं। कृपया यह अनुरोध कम से कम 24 घंटे पहले 'Services' अनुभाग के माध्यम से करें।",
        ar: "تهانينا! يمكننا ترتيب زخارف خاصة للغرفة أو كعكات أو زهور. يرجى طلب ذلك عبر قسم 'الخدمات' قبل 24 ساعة على الأقل."
    },
    'babysitting|child care|kids club': {
        en: "Babysitting services can be arranged through the concierge with prior notice. Additional charges apply.",
        hi: "बेबीसिटिंग सेवाएँ पूर्व सूचना के साथ कंसीयज के माध्यम से व्यवस्थित की जा सकती हैं। अतिरिक्त शुल्क लागू होता है।",
        ar: "يمكن ترتيب خدمات جليسة الأطفال من خلال الكونسيرج مع إشعار مسبق. تطبق رسوم إضافية."
    },

    // ============================================================
    // 11. EMERGENCIES & HUMAN ESCALATION
    // ============================================================
    'emergency|urgent|help|doctor|hospital|police|ambulance|fire': {
        en: "🚨 For immediate emergency assistance, please call the reception directly (Dial 0) or use the Emergency button in the app.",
        hi: "🚨 तत्काल आपातकालीन सहायता के लिए, कृपया सीधे रिसेप्शन को कॉल करें (0 डायल करें) या ऐप में इमरजेंसी बटन का उपयोग करें।",
        ar: "🚨 للمساعدة الطارئة الفورية، يرجى الاتصال بالمكتب الأمامي مباشرة (اطلب 0) أو استخدام زر الطوارئ في التطبيق."
    },
    'live chat|chat|support|help|human|agent|manager|speak to someone|talk to person': {
        en: "I understand you need human assistance. Please click the 'Live Chat' or 'Call Reception' button in the 24/7 Support tab.",
        hi: "मैं समझता हूँ कि आपको मानव सहायता की आवश्यकता है। कृपया 24/7 सपोर्ट टैब में 'Live Chat' या 'Call Reception' बटन पर क्लिक करें।",
        ar: "أفهم أنك بحاجة إلى مساعدة بشرية. يرجى النقر على زر 'الدردشة المباشرة' أو 'الاتصال بالمكتب الأمامي' في علامة تبويب الدعم 24/7."
    },

    // ============================================================
    // 12. GENERAL HOTEL INFO & MISC
    // ============================================================
    'floor map|elevator|lift|escalator|stairs': {
        en: "Elevators are located next to the main lobby. A digital floor map is available on the TV in your room.",
        hi: "लिफ्ट मुख्य लॉबी के बगल में स्थित हैं। आपके कमरे में टीवी पर एक डिजिटल फ्लोर मैप उपलब्ध है।",
        ar: "تقع المصاعد بجوار البهو الرئيسي. تتوفر خريطة رقمية للطابق على التلفزيون في غرفتك."
    },
    'ice machine|ice cubes': {
        en: "Ice machines are located on every alternate floor near the elevator lobby.",
        hi: "आइस मशीनें लिफ्ट लॉबी के पास हर वैकल्पिक मंजिल पर स्थित हैं।",
        ar: "توجد آلات الثلج في كل طابق بديل بالقرب من بهو المصعد."
    },
    'vending machine|snack machine|drink machine': {
        en: "Vending machines offering snacks and beverages are located near the lobby and on the 2nd floor.",
        hi: "नाश्ते और पेय पदार्थों की पेशकश करने वाली वेंडिंग मशीनें लॉबी के पास और दूसरी मंजिल पर स्थित हैं।",
        ar: "توجد آلات بيع تقدم الوجبات الخفيفة والمشروبات بالقرب من البهو وفي الطابق الثاني."
    },
    'newspaper|magazine|news|paper': {
        en: "Complimentary newspapers are delivered to your room every morning. Digital versions are also available on request.",
        hi: "कॉम्प्लीमेंटरी अखबार हर सुबह आपके कमरे में पहुंचाए जाते हैं। अनुरोध पर डिजिटल संस्करण भी उपलब्ध हैं।",
        ar: "يتم تسليم الصحف المجانية إلى غرفتك كل صباح. تتوفر أيضاً نسخ رقمية عند الطلب."
    },
    'cancellation policy|no show|refund policy': {
        en: "Cancellation policies vary by booking type. Please refer to your booking confirmation email or contact reception for details.",
        hi: "रद्दीकरण नीतियाँ बुकिंग के प्रकार के अनुसार भिन्न होती हैं। कृपया अपने बुकिंग पुष्टि ईमेल देखें या विवरण के लिए रिसेप्शन से संपर्क करें।",
        ar: "تختلف سياسات الإلغاء حسب نوع الحجز. يرجى الرجوع إلى رسالة تأكيد الحجز عبر البريد الإلكتروني أو الاتصال بالمكتب الأمامي للحصول على التفاصيل."
    }
};

// ============================================================
// MAIN AI CHAT ENDPOINT (WITH REAL-TIME CONTEXT ENRICHMENT)
// ============================================================
router.post('/message', async (req, res) => {
    try {
        const db = getDB();
        const { hotelId, guestId, message, language = 'en' } = req.body;

        if (!hotelId) return res.status(400).json({ success: false, message: 'hotelId is required' });
        if (!message) return res.status(400).json({ success: false, message: 'message is required' });

        let customResponses = {};
        let faqs = {};
        let fallback = FALLBACK_RESPONSES[language] || FALLBACK_RESPONSES.en;

        try {
            const aiConfig = await db.collection('hotel_ai_settings').findOne({ hotel_id: hotelId });
            if (aiConfig) {
                customResponses = aiConfig.custom_responses || {};
                faqs = aiConfig.faq_json || {};
                if (aiConfig.fallback_response) {
                    fallback = aiConfig.fallback_response[language] || aiConfig.fallback_response.en || fallback;
                }
            }
        } catch (e) {
            console.warn('AI Config not found, using defaults:', e.message);
        }

        const lowerMsg = message.toLowerCase().trim();
        let reply = fallback;
        let matched = false;
        let matchedKey = '';
        let suggestedActions = [];

        // 1️⃣ Check hotel-specific custom responses first
        for (const [key, value] of Object.entries(customResponses)) {
            if (lowerMsg.includes(key.toLowerCase())) {
                reply = language === 'ar' ? (value.ar || value.en) : (value.en || value);
                matched = true;
                matchedKey = key;
                break;
            }
        }

        // 2️⃣ Check FAQs if no custom response matched
        if (!matched) {
            for (const [question, answer] of Object.entries(faqs)) {
                const qLower = question.toLowerCase();
                if (lowerMsg.includes(qLower) || qLower.includes(lowerMsg)) {
                    reply = language === 'ar' ? (answer.ar || answer.en) : (answer.en || answer);
                    matched = true;
                    matchedKey = question;
                    break;
                }
            }
        }

        // 3️⃣ Check built-in smart keywords if no custom/faq matched
        if (!matched) {
            for (const [pattern, responses] of Object.entries(SMART_KEYWORDS)) {
                const patterns = pattern.split('|');
                for (const p of patterns) {
                    if (lowerMsg.includes(p.toLowerCase())) {
                        reply = language === 'ar' ? (responses.ar || responses.en) : responses.en;
                        matched = true;
                        matchedKey = pattern;
                        break;
                    }
                }
                if (matched) break;
            }
        }

        // ============================================================
        // === REAL-TIME CONTEXT ENRICHMENT (Dynamic Data) ===
        // ============================================================
        try {
            if (guestId && guestId !== 'anonymous') {
                // Bill Context
                if (matchedKey.includes('bill') || matchedKey.includes('payment') || matchedKey.includes('balance')) {
                    const pendingBill = await db.collection('bills').findOne({ 
                        hotel_id: hotelId, guest_id: guestId, status: 'pending' 
                    });
                    if (pendingBill && pendingBill.total_amount > 0) {
                        const amount = pendingBill.total_amount;
                        const currency = pendingBill.currency || 'SAR';
                        reply += `\n\n💡 *Your current pending balance is ${currency} ${amount}.*`;
                        suggestedActions.push({ label: 'View Full Bill', action: 'open_payments' });
                        suggestedActions.push({ label: 'Pay Now', action: 'initiate_payment' });
                    } else {
                        reply += `\n\n✅ *You have no pending bills. Your account is clear!*`;
                    }
                }

                // Ticket Context
                if (matchedKey.includes('complaint') || matchedKey.includes('problem') || matchedKey.includes('issue')) {
                    const activeTickets = await db.collection('support_tickets').countDocuments({ 
                        hotel_id: hotelId, guest_id: guestId, status: { $in: ['open', 'in_progress'] } 
                    });
                    if (activeTickets > 0) {
                        reply += `\n\n📌 *You have ${activeTickets} active request(s). Our team is working on it.*`;
                        suggestedActions.push({ label: 'Check Ticket Status', action: 'open_tickets' });
                    } else {
                        suggestedActions.push({ label: 'Raise New Ticket', action: 'open_support' });
                    }
                }
            }
        } catch (contextErr) {
            console.warn('Context enrichment failed (non-critical):', contextErr.message);
        }

        // === AUTO-SUGGEST ACTIONS FOR FALLBACK ===
        if (!matched && suggestedActions.length === 0) {
            suggestedActions = [
                { label: '📞 Call Reception', action: 'call_reception' },
                { label: '💬 Live Chat', action: 'open_live_chat' }
            ];
        }

        // 4️⃣ Save chat history to database
        try {
            await db.collection('chat_history').insertOne({
                hotel_id: hotelId,
                guest_id: guestId || 'anonymous',
                user_message: message,
                bot_response: reply,
                matched_key: matchedKey || 'fallback',
                language,
                created_at: new Date()
            });
        } catch (e) {
            console.warn('Failed to save chat history:', e.message);
        }

        // 5️⃣ Return response
        res.json({ 
            success: true, 
            reply,
            matched: matchedKey || 'fallback',
            suggestedActions
        });

    } catch (error) {
        console.error('Error in AI chat:', error);
        res.status(500).json({ success: false, message: 'Server error. Please try again later.' });
    }
});

// ============================================================
// GET CHAT HISTORY FOR A GUEST
// ============================================================
router.get('/history/:guestId', async (req, res) => {
    try {
        const db = getDB();
        const { guestId } = req.params;
        const { hotelId, limit = 50 } = req.query;

        if (!guestId || !hotelId) {
            return res.status(400).json({ success: false, message: 'guestId and hotelId are required' });
        }

        const history = await db.collection('chat_history')
            .find({ guest_id: guestId, hotel_id: hotelId })
            .sort({ created_at: -1 })
            .limit(parseInt(limit))
            .toArray();

        res.json({ success: true, data: history.reverse() });
    } catch (error) {
        console.error('Error fetching chat history:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ============================================================
// GET AI CONFIG FOR HOTEL (Admin)
// ============================================================
router.get('/config/:hotelId', async (req, res) => {
    try {
        const db = getDB();
        const { hotelId } = req.params;
        const config = await db.collection('hotel_ai_settings').findOne({ hotel_id: hotelId });

        res.json({ 
            success: true, 
            data: config || { 
                hotel_id: hotelId,
                custom_responses: {},
                faq_json: {},
                fallback_response: FALLBACK_RESPONSES
            }
        });
    } catch (error) {
        console.error('Error fetching AI config:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ============================================================
// UPDATE AI CONFIG FOR HOTEL (Admin)
// ============================================================
router.post('/config', async (req, res) => {
    try {
        const db = getDB();
        const { hotelId, customResponses, faqJson, fallbackResponse } = req.body;

        if (!hotelId) {
            return res.status(400).json({ success: false, message: 'hotelId is required' });
        }

        const updateData = {
            hotel_id: hotelId,
            custom_responses: customResponses || {},
            faq_json: faqJson || {},
            fallback_response: fallbackResponse || FALLBACK_RESPONSES,
            updated_at: new Date()
        };

        await db.collection('hotel_ai_settings').updateOne(
            { hotel_id: hotelId },
            { $set: updateData },
            { upsert: true }
        );

        res.json({ success: true, message: 'AI config updated successfully', data: updateData });
    } catch (error) {
        console.error('Error updating AI config:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;
