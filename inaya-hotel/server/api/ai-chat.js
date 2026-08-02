const express = require('express');
const router = express.Router();
const { getDB } = require('../config/db');

// ============================================================
// AI CHAT — SMART AUTO-REPLY ENGINE
// ============================================================

// ========== DEFAULT FALLBACK RESPONSES (Multilingual) ==========
const FALLBACK_RESPONSES = {
    en: "I'm sorry, I didn't quite understand that. Please contact 24/7 support.",
    hi: "मुझे क्षमा करें, मैं वह समझ नहीं पाया। कृपया 24/7 सहायता से संपर्क करें।",
    ar: "آسف، لم أفهم ذلك تمامًا. يرجى الاتصال بالدعم 24/7."
};

// ========== BUILT-IN SMART KEYWORD MATCHING ==========
const SMART_KEYWORDS = {
    // Greetings
    'hi|hello|hey|good morning|good evening|good afternoon': {
        en: "Hello! Welcome to our hotel. How can I assist you today?",
        hi: "नमस्ते! हमारे होटल में आपका स्वागत है। आज मैं आपकी कैसे सहायता कर सकता हूँ?",
        ar: "مرحباً! أهلاً بك في فندقنا. كيف يمكنني مساعدتك اليوم؟"
    },
    'bye|goodbye|see you|thank you': {
        en: "Thank you for staying with us. Have a wonderful day!",
        hi: "हमारे साथ रहने के लिए धन्यवाद। आपका दिन शुभ हो!",
        ar: "شكراً لإقامتك معنا. أتمنى لك يوماً رائعاً!"
    },
    // Payments & Billing
    'bill|payment|invoice|gst|receipt|pay': {
        en: "You can check your bill and payment details in the Payments section or contact reception.",
        hi: "आप अपना बिल और भुगतान विवरण भुगतान अनुभाग में देख सकते हैं या रिसेप्शन से संपर्क कर सकते हैं।",
        ar: "يمكنك التحقق من تفاصيل الفاتورة والدفع في قسم المدفوعات أو الاتصال بالمكتب الأمامي."
    },
    // WiFi
    'wifi|internet|password|network|connect': {
        en: "Please check the WiFi Password option in the Payments section or contact reception.",
        hi: "कृपया भुगतान अनुभाग में वाईफाई पासवर्ड विकल्प देखें या रिसेप्शन से संपर्क करें।",
        ar: "يرجى التحقق من خيار كلمة مرور WiFi في قسم المدفوعات أو الاتصال بالمكتب الأمامي."
    },
    // Checkout
    'checkout|check out|departure|leaving': {
        en: "You can complete checkout from the Checkout section or visit the reception.",
        hi: "आप चेकआउट अनुभाग से चेकआउट पूरा कर सकते हैं या रिसेप्शन पर जा सकते हैं।",
        ar: "يمكنك إكمال تسجيل المغادرة من قسم المغادرة أو زيارة المكتب الأمامي."
    },
    // Room Service
    'room service|order food|food delivery|dining': {
        en: "Room service is available. Please use the Services section to place your request.",
        hi: "रूम सर्विस उपलब्ध है। कृपया अपना अनुरोध देने के लिए सेवाएँ अनुभाग का उपयोग करें।",
        ar: "خدمة الغرف متاحة. يرجى استخدام قسم الخدمات لتقديم طلبك."
    },
    // Housekeeping
    'housekeeping|cleaning|towel|pillow|blanket|extra bed|iron|hair dryer': {
        en: "Housekeeping can be requested anytime from the Services section.",
        hi: "हाउसकीपिंग कभी भी सेवाएँ अनुभाग से अनुरोध की जा सकती है।",
        ar: "يمكن طلب خدمة التدبير المنزلي في أي وقت من قسم الخدمات."
    },
    // Parking
    'parking|valet|car': {
        en: "Parking is available for hotel guests. Please contact reception for parking assistance.",
        hi: "होटल के मेहमानों के लिए पार्किंग उपलब्ध है। पार्किंग सहायता के लिए कृपया रिसेप्शन से संपर्क करें।",
        ar: "موقف السيارات متاح لنزلاء الفندق. يرجى الاتصال بالمكتب الأمامي للمساعدة في موقف السيارات."
    },
    // Restaurant / Breakfast
    'breakfast|restaurant|food|menu|lunch|dinner|coffee|tea': {
        en: "Please visit the Restaurant/Menu section or contact room service for dining options.",
        hi: "कृपया भोजन विकल्पों के लिए रेस्तरां/मेनू अनुभाग देखें या रूम सर्विस से संपर्क करें।",
        ar: "يرجى زيارة قسم المطعم/القائمة أو الاتصال بخدمة الغرف لخيارات تناول الطعام."
    },
    // Spa
    'spa|massage|wellness|relax|sauna': {
        en: "Spa services can be booked from the Services section.",
        hi: "स्पा सेवाएँ सेवाएँ अनुभाग से बुक की जा सकती हैं।",
        ar: "يمكن حجز خدمات السبا من قسم الخدمات."
    },
    // Laundry
    'laundry|wash|dry clean|ironing': {
        en: "Laundry service is available. Please request it from the Services section.",
        hi: "लॉन्ड्री सेवा उपलब्ध है। कृपया इसे सेवाएँ अनुभाग से अनुरोध करें।",
        ar: "خدمة الغسيل متاحة. يرجى طلبها من قسم الخدمات."
    },
    // Late Checkout
    'late checkout|extend stay|extension': {
        en: "Late checkout depends on availability. Please contact reception.",
        hi: "लेट चेकआउट उपलब्धता पर निर्भर करता है। कृपया रिसेप्शन से संपर्क करें।",
        ar: "تسجيل المغادرة المتأخر يعتمد على التوفر. يرجى الاتصال بالمكتب الأمامي."
    },
    // Complaint
    'complaint|problem|issue|not working|broken|tv|ac|hot water|noise|electricity': {
        en: "We're sorry for the inconvenience. Please raise a request in the 24/7 Support section.",
        hi: "असुविधा के लिए हमें खेद है। कृपया 24/7 सहायता अनुभाग में अनुरोध दर्ज करें।",
        ar: "نأسف على الإزعاج. يرجى تقديم طلب في قسم الدعم 24/7."
    },
    // Transport
    'taxi|cab|transport|airport pickup|airport drop|pickup|drop': {
        en: "Taxi and transport services are available through the Transport section.",
        hi: "टैक्सी और परिवहन सेवाएँ परिवहन अनुभाग के माध्यम से उपलब्ध हैं।",
        ar: "خدمات سيارات الأجرة والنقل متاحة من خلال قسم النقل."
    },
    // Check-in
    'check in|check-in|arrival|arrive': {
        en: "Standard check-in time is usually from 2:00 PM. Please confirm with reception.",
        hi: "मानक चेक-इन समय आमतौर पर दोपहर 2:00 बजे से होता है। कृपया रिसेप्शन से पुष्टि करें।",
        ar: "وقت تسجيل الوصول القياسي عادة من الساعة 2:00 ظهراً. يرجى التأكيد مع المكتب الأمامي."
    },
    // Emergency
    'emergency|urgent|help|doctor|hospital|police|ambulance': {
        en: "For immediate assistance, please call reception or use the Emergency option.",
        hi: "तत्काल सहायता के लिए, कृपया रिसेप्शन को कॉल करें या आपातकालीन विकल्प का उपयोग करें।",
        ar: "للمساعدة الفورية، يرجى الاتصال بالمكتب الأمامي أو استخدام خيار الطوارئ."
    },
    // Pool
    'pool|swimming|swim': {
        en: "The swimming pool is open during hotel operating hours. Please check with reception.",
        hi: "स्विमिंग पूल होटल के परिचालन घंटों के दौरान खुला रहता है। कृपया रिसेप्शन से जाँच करें।",
        ar: "المسبح مفتوح خلال ساعات عمل الفندق. يرجى الاستفسار من المكتب الأمامي."
    },
    // Gym
    'gym|fitness|workout|exercise': {
        en: "Our fitness center is available for hotel guests. Please see the Amenities section.",
        hi: "हमारा फिटनेस सेंटर होटल के मेहमानों के लिए उपलब्ध है। कृपया सुविधाएँ अनुभाग देखें।",
        ar: "مركز اللياقة البدنية متاح لنزلاء الفندق. يرجى الاطلاع على قسم وسائل الراحة."
    },
    // Meeting Room
    'meeting|conference|banquet|event': {
        en: "Meeting and conference facilities can be booked through reception.",
        hi: "बैठक और सम्मेलन सुविधाएँ रिसेप्शन के माध्यम से बुक की जा सकती हैं।",
        ar: "يمكن حجز مرافق الاجتماعات والمؤتمرات من خلال المكتب الأمامي."
    },
    // Wake-up Call
    'wake up|wakeup|morning call': {
        en: "You can request a wake-up call from the Services section.",
        hi: "आप सेवाएँ अनुभाग से वेक-अप कॉल का अनुरोध कर सकते हैं।",
        ar: "يمكنك طلب مكالمة إيقاظ من قسم الخدمات."
    },
    // Lost & Found
    'lost|found|lost item|missing|forgot': {
        en: "Please report lost items using the Lost & Found section.",
        hi: "कृपया खोई हुई वस्तुओं की रिपोर्ट खोया-पाया अनुभाग का उपयोग करके करें।",
        ar: "يرجى الإبلاغ عن العناصر المفقودة باستخدام قسم المفقودات."
    },
    // Luggage Storage
    'luggage|baggage|storage|bag|suitcase': {
        en: "Luggage storage is available before check-in and after checkout.",
        hi: "चेक-इन से पहले और चेक-आउट के बाद सामान भंडारण उपलब्ध है।",
        ar: "تتوفر خدمة تخزين الأمتعة قبل تسجيل الوصول وبعد تسجيل المغادرة."
    },
    // Nearby Attractions
    'attraction|nearby|tourist|sightseeing|place': {
        en: "Please check the Nearby Attractions section or ask reception.",
        hi: "कृपया आस-पास के आकर्षण अनुभाग देखें या रिसेप्शन से पूछें।",
        ar: "يرجى التحقق من قسم المعالم القريبة أو الاستفسار من المكتب الأمامي."
    },
    // Smoking
    'smoking|smoke|smoker': {
        en: "Smoking is only permitted in designated smoking areas.",
        hi: "धूम्रपान केवल निर्दिष्ट धूम्रपान क्षेत्रों में ही अनुमत है।",
        ar: "يُسمح بالتدخين فقط في مناطق التدخين المخصصة."
    },
    // Pet Policy
    'pet|dog|cat|animal|pets': {
        en: "Please check the hotel's pet policy or contact reception.",
        hi: "कृपया होटल की पालतू जानवर नीति देखें या रिसेप्शन से संपर्क करें।",
        ar: "يرجى التحقق من سياسة الفندق بشأن الحيوانات الأليفة أو الاتصال بالمكتب الأمامي."
    },
    // Baby Crib / Extra Bed
    'baby|crib|cot|child|extra bed': {
        en: "Baby cribs and extra beds are available on request, subject to availability.",
        hi: "बेबी क्रिब और अतिरिक्त बिस्तर अनुरोध पर उपलब्ध हैं, उपलब्धता के अधीन।",
        ar: "أسرّة الأطفال والأسرة الإضافية متوفرة عند الطلب، حسب التوفر."
    },
    // Safe Locker
    'safe|locker|security|lock': {
        en: "Each room includes a safe locker. Contact reception if you need assistance.",
        hi: "प्रत्येक कमरे में एक सेफ लॉकर शामिल है। यदि आपको सहायता की आवश्यकता हो तो रिसेप्शन से संपर्क करें।",
        ar: "كل غرفة تشمل خزنة آمنة. اتصل بالمكتب الأمامي إذا كنت بحاجة إلى مساعدة."
    },
    // Room Change
    'change room|room change|shift|move': {
        en: "Room changes are subject to availability. Please contact reception.",
        hi: "कमरे में बदलाव उपलब्धता के अधीन है। कृपया रिसेप्शन से संपर्क करें।",
        ar: "تغيير الغرفة حسب التوفر. يرجى الاتصال بالمكتب الأمامي."
    },
    // Discount / Offers
    'discount|offer|deal|promo|coupon': {
        en: "Current hotel offers are available in the Offers section.",
        hi: "वर्तमान होटल ऑफ़र ऑफ़र अनुभाग में उपलब्ध हैं।",
        ar: "العروض الحالية للفندق متاحة في قسم العروض."
    },
    // Loyalty Program
    'loyalty|points|rewards|membership': {
        en: "Please visit the Loyalty section to view available rewards.",
        hi: "कृपया उपलब्ध पुरस्कार देखने के लिए लॉयल्टी अनुभाग पर जाएँ।",
        ar: "يرجى زيارة قسم الولاء لعرض المكافآت المتاحة."
    },
    // QR Code
    'qr code|scan|code|qr': {
        en: "Please scan the room QR code to access all hotel services.",
        hi: "कृपया सभी होटल सेवाओं तक पहुँचने के लिए कमरा QR कोड स्कैन करें।",
        ar: "يرجى مسح رمز QR الخاص بالغرفة للوصول إلى جميع خدمات الفندق."
    },
    // Contact Number
    'contact|phone|number|call|reception': {
        en: "Reception is available 24/7. You can find all hotel contact details in the Contact Us section.",
        hi: "रिसेप्शन 24/7 उपलब्ध है। आप सभी होटल संपर्क विवरण हमसे संपर्क करें अनुभाग में पा सकते हैं।",
        ar: "المكتب الأمامي متاح 24/7. يمكنك العثور على جميع تفاصيل الاتصال بالفندق في قسم اتصل بنا."
    },
    // Language Support
    'language|translate|english|hindi|arabic': {
        en: "We support multiple languages. Please select your preferred language.",
        hi: "हम कई भाषाओं का समर्थन करते हैं। कृपया अपनी पसंदीदा भाषा चुनें।",
        ar: "نحن ندعم لغات متعددة. يرجى اختيار لغتك المفضلة."
    },
    // Feedback / Review
    'feedback|review|rating|suggest|opinion': {
        en: "We value your feedback. Please submit your review in the Feedback section.",
        hi: "हम आपकी प्रतिक्रिया को महत्व देते हैं। कृपया अपनी समीक्षा प्रतिक्रिया अनुभाग में जमा करें।",
        ar: "نحن نقدر ملاحظاتك. يرجى تقديم تقييمك في قسم الملاحظات."
    },
    // Live Chat
    'live chat|chat|support|help': {
        en: "Our support team is available through Live Chat 24/7.",
        hi: "हमारी सहायता टीम लाइव चैट के माध्यम से 24/7 उपलब्ध है।",
        ar: "فريق الدعم لدينا متاح من خلال الدردشة المباشرة 24/7."
    },
    // Restroom / Washroom
    'restroom|washroom|bathroom|toilet|loo': {
        en: "Restrooms are located on every floor. Please refer to the floor map.",
        hi: "रेस्टरूम हर मंजिल पर स्थित हैं। कृपया फ्लोर मैप देखें।",
        ar: "تقع دورات المياه في كل طابق. يرجى الرجوع إلى خريطة الطابق."
    },
    // Elevator / Lift
    'elevator|lift|escalator': {
        en: "Elevators are available near the main lobby. Please use the floor map for directions.",
        hi: "लिफ्ट मुख्य लॉबी के पास उपलब्ध हैं। दिशा-निर्देश के लिए कृपया फ्लोर मैप का उपयोग करें।",
        ar: "المصاعد متاحة بالقرب من البهو الرئيسي. يرجى استخدام خريطة الطابق للحصول على الاتجاهات."
    },
    // Ice Machine
    'ice|cube|ice machine': {
        en: "Ice machines are available on designated floors. Please contact reception for the nearest location.",
        hi: "आइस मशीनें निर्दिष्ट मंजिलों पर उपलब्ध हैं। निकटतम स्थान के लिए कृपया रिसेप्शन से संपर्क करें।",
        ar: "آلات الثلج متاحة في الطوابق المخصصة. يرجى الاتصال بالمكتب الأمامي للحصول على أقرب موقع."
    },
    // Vending Machine
    'vending|snack|drink|machine': {
        en: "Vending machines are located near the lobby and common areas.",
        hi: "वेंडिंग मशीनें लॉबी और सामान्य क्षेत्रों के पास स्थित हैं।",
        ar: "تقع آلات البيع بالقرب من البهو والمناطق المشتركة."
    },
    // Business Center
    'business center|business|work|office': {
        en: "Our business center is open 24/7. Please contact reception for access.",
        hi: "हमारा बिजनेस सेंटर 24/7 खुला है। पहुँच के लिए कृपया रिसेप्शन से संपर्क करें।",
        ar: "مركز الأعمال لدينا مفتوح 24/7. يرجى الاتصال بالمكتب الأمامي للوصول."
    },
    // Kids Play Area
    'kids|children|play|playground': {
        en: "We have a kids' play area available. Please check with reception for timings.",
        hi: "हमारे पास बच्चों का खेल क्षेत्र उपलब्ध है। समय के लिए कृपया रिसेप्शन से जाँच करें।",
        ar: "لدينا منطقة لعب للأطفال متاحة. يرجى الاستفسار من المكتب الأمامي عن التوقيتات."
    },
    // Currency Exchange
    'currency|exchange|money|cash': {
        en: "Currency exchange services are available at the front desk.",
        hi: "मुद्रा विनिमय सेवाएँ फ्रंट डेस्क पर उपलब्ध हैं।",
        ar: "خدمات صرف العملات متاحة في المكتب الأمامي."
    },
    // Newspaper / Magazine
    'newspaper|magazine|news|paper': {
        en: "Daily newspapers and magazines are available in the lobby reading area.",
        hi: "दैनिक समाचार पत्र और पत्रिकाएँ लॉबी रीडिंग क्षेत्र में उपलब्ध हैं।",
        ar: "الصحف والمجلات اليومية متاحة في منطقة القراءة بالبهو."
    }
};

// ============================================================
// MAIN AI CHAT ENDPOINT
// ============================================================
router.post('/message', async (req, res) => {
    try {
        const db = getDB();
        const { hotelId, guestId, message, language = 'en' } = req.body;

        // Validate inputs
        if (!hotelId) {
            return res.status(400).json({ success: false, message: 'hotelId is required' });
        }
        if (!message) {
            return res.status(400).json({ success: false, message: 'message is required' });
        }

        // Get AI Config from database (hotel-specific custom responses)
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
            matched: matchedKey || 'fallback'
        });

    } catch (error) {
        console.error('Error in AI chat:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error. Please try again later.' 
        });
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

        const result = await db.collection('hotel_ai_settings').updateOne(
            { hotel_id: hotelId },
            { $set: updateData },
            { upsert: true }
        );

        res.json({ 
            success: true, 
            message: 'AI config updated successfully',
            data: updateData
        });
    } catch (error) {
        console.error('Error updating AI config:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;
