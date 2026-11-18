// Languages for the website: English, हिन्दी (Hindi) and मराठी (Marathi).
// Each entry is: "English text": ["Hindi", "Marathi"]. {name} parts are filled in by the app.
// Texts the owner changes in the owner panel are shown as written there (no automatic translation);
// the original default texts below have ready translations.
(function () {
  const LANGS = { en: "English", hi: "हिन्दी", mr: "मराठी" };
  const D = {
    // header, footer, general
    "Passenger": ["यात्री", "प्रवासी"],
    "Driver": ["ड्राइवर", "चालक"],
    "Language": ["भाषा", "भाषा"],
    "📍 My location": ["📍 मेरी लोकेशन", "📍 माझे लोकेशन"],
    "Logged in as {name}": ["{name} के रूप में लॉग इन", "{name} म्हणून लॉग इन"],
    "Log out": ["लॉग आउट", "लॉग आउट"],
    "Disclaimer:": ["अस्वीकरण:", "अस्वीकरण:"],
    "Passenger safety:": ["यात्री सुरक्षा:", "प्रवासी सुरक्षा:"],
    "Owner login": ["मालिक लॉग इन", "मालक लॉग इन"],
    "Operated by {name}": ["संचालक: {name}", "संचालक: {name}"],
    "Registered office: {a}": ["पंजीकृत कार्यालय: {a}", "नोंदणीकृत कार्यालय: {a}"],
    "Email: {e}": ["ईमेल: {e}", "ईमेल: {e}"],
    "Phone: {p}": ["फ़ोन: {p}", "फोन: {p}"],
    "Close": ["बंद करें", "बंद करा"],
    "Save": ["सहेजें", "जतन करा"],
    "Cancel": ["रद्द करें", "रद्द करा"],
    "Reconnecting… live updates paused.": ["फिर से जुड़ रहे हैं… लाइव अपडेट रुके हैं।", "पुन्हा जोडत आहोत… थेट अपडेट थांबले आहेत."],
    "Could not reach myrightmyride.com. Check your internet connection and reload.": ["myrightmyride.com तक नहीं पहुँच सके। इंटरनेट कनेक्शन जाँचकर पेज दोबारा खोलें।", "myrightmyride.com पर्यंत पोहोचता आले नाही. इंटरनेट कनेक्शन तपासून पेज पुन्हा उघडा."],

    // login
    "Log in": ["लॉग इन करें", "लॉग इन करा"],
    "Log in with your mobile number to book or drive. No Google account needed.": ["राइड बुक करने या गाड़ी चलाने के लिए अपने मोबाइल नंबर से लॉग इन करें। Google खाते की ज़रूरत नहीं।", "राइड बुक करण्यासाठी किंवा गाडी चालवण्यासाठी आपल्या मोबाइल नंबरने लॉग इन करा. Google खात्याची गरज नाही."],
    "Your name": ["आपका नाम", "आपले नाव"],
    "Mobile number": ["मोबाइल नंबर", "मोबाइल नंबर"],
    "10-digit mobile": ["10 अंकों का मोबाइल नंबर", "10 अंकी मोबाइल नंबर"],
    "Test mode: your OTP is {otp}. On the live site it comes by SMS.": ["टेस्ट मोड: आपका OTP {otp} है। असली साइट पर यह SMS से आएगा।", "चाचणी मोड: आपला OTP {otp} आहे. प्रत्यक्ष साइटवर तो SMS ने येईल."],
    "We sent a 6-digit OTP by SMS to {phone}.": ["हमने {phone} पर SMS से 6 अंकों का OTP भेजा है।", "आम्ही {phone} वर SMS ने 6 अंकी OTP पाठवला आहे."],
    "Enter the OTP": ["OTP डालें", "OTP टाका"],
    "Send a new OTP": ["नया OTP भेजें", "नवीन OTP पाठवा"],
    "Send OTP": ["OTP भेजें", "OTP पाठवा"],
    "Enter your name.": ["अपना नाम डालें।", "आपले नाव टाका."],

    // map
    "Finding the address…": ["पता खोजा जा रहा है…", "पत्ता शोधत आहोत…"],
    "This browser can't share your location.": ["यह ब्राउज़र आपकी लोकेशन नहीं बता सकता।", "हा ब्राउझर आपले लोकेशन देऊ शकत नाही."],
    "Finding your location…": ["आपकी लोकेशन खोजी जा रही है…", "आपले लोकेशन शोधत आहोत…"],
    "Your location, accurate to about {m} m": ["आपकी लोकेशन, लगभग {m} मीटर तक सटीक", "आपले लोकेशन, सुमारे {m} मीटरपर्यंत अचूक"],
    "You are here": ["आप यहाँ हैं", "आपण येथे आहात"],
    "Location permission was refused. Allow location for this site in your browser settings.": ["लोकेशन की अनुमति नहीं दी गई। ब्राउज़र की सेटिंग में इस साइट के लिए लोकेशन की अनुमति दें।", "लोकेशनची परवानगी नाकारली गेली. ब्राउझरच्या सेटिंगमध्ये या साइटसाठी लोकेशनला परवानगी द्या."],
    "Could not get your location. Turn on GPS and try again.": ["आपकी लोकेशन नहीं मिल सकी। GPS चालू करके फिर से कोशिश करें।", "आपले लोकेशन मिळाले नाही. GPS चालू करून पुन्हा प्रयत्न करा."],
    "About {km} km in a straight line": ["सीधी रेखा में लगभग {km} किमी", "सरळ रेषेत सुमारे {km} किमी"],
    "Now set your drop place": ["अब अपनी ड्रॉप की जगह चुनें", "आता आपले उतरण्याचे ठिकाण निवडा"],
    "Now set your pickup place": ["अब अपनी पिकअप की जगह चुनें", "आता आपले पिकअपचे ठिकाण निवडा"],
    "Pickup: {p}": ["पिकअप: {p}", "पिकअप: {p}"],
    "Drop: {p}": ["ड्रॉप: {p}", "उतरणे: {p}"],
    "Passenger waiting: {p}": ["यात्री इंतज़ार कर रहा है: {p}", "प्रवासी वाट पाहत आहे: {p}"],
    "Tap the map where you want your pickup.": ["नक्शे पर वहाँ टैप करें जहाँ आपको पिकअप चाहिए।", "नकाशावर जिथे पिकअप हवे तिथे टॅप करा."],
    "Tap the map where you want your drop.": ["नक्शे पर वहाँ टैप करें जहाँ आपको उतरना है।", "नकाशावर जिथे उतरायचे तिथे टॅप करा."],
    "You": ["आप", "आपण"],

    // booking
    "Book a ride": ["राइड बुक करें", "राइड बुक करा"],
    "Pickup place": ["पिकअप की जगह", "पिकअपचे ठिकाण"],
    "Type address, village, station, office, society…": ["पता, गाँव, स्टेशन, दफ़्तर, सोसाइटी लिखें…", "पत्ता, गाव, स्टेशन, कार्यालय, सोसायटी लिहा…"],
    "📍 Use my current location": ["📍 मेरी अभी की लोकेशन लें", "📍 माझे सध्याचे लोकेशन वापरा"],
    "Choose from list": ["सूची से चुनें", "यादीतून निवडा"],
    "Tap on map": ["नक्शे पर टैप करें", "नकाशावर टॅप करा"],
    "🚉 Pick me up at a railway station": ["🚉 रेलवे स्टेशन से पिकअप", "🚉 रेल्वे स्टेशनवरून पिकअप"],
    "🚉 Railway station": ["🚉 रेलवे स्टेशन", "🚉 रेल्वे स्टेशन"],
    "Drop place": ["ड्रॉप की जगह", "उतरण्याचे ठिकाण"],
    "Where do you want to go?": ["आपको कहाँ जाना है?", "आपल्याला कुठे जायचे आहे?"],
    "Suggest a missing place": ["छूटी हुई जगह सुझाएँ", "राहिलेले ठिकाण सुचवा"],
    "House no. or landmark for the driver (optional)": ["ड्राइवर के लिए मकान नंबर या पहचान की जगह (वैकल्पिक)", "चालकासाठी घर क्रमांक किंवा खूण (ऐच्छिक)"],
    "e.g. Flat 4, Sai Krupa CHS, near the temple gate": ["जैसे फ़्लैट 4, साई कृपा सोसाइटी, मंदिर के गेट के पास", "उदा. फ्लॅट 4, साई कृपा सोसायटी, मंदिराच्या गेटजवळ"],
    "Vehicle": ["वाहन", "वाहन"],
    "Fare": ["किराया", "भाडे"],
    "As per meter": ["मीटर के अनुसार", "मीटरप्रमाणे"],
    "Pay what the vehicle's meter shows at the end of the ride": ["राइड के अंत में वाहन का मीटर जो दिखाए, वही दें", "राइडच्या शेवटी वाहनाचे मीटर जे दाखवेल तेवढे द्या"],
    "I will decide the fare": ["किराया मैं खुद तय करूँगा/करूँगी", "भाडे मी स्वतः ठरवेन"],
    "Set your own price. Drivers can accept or decline it but cannot change it.": ["अपना किराया खुद तय करें। ड्राइवर इसे मान या ठुकरा सकते हैं, पर बदल नहीं सकते।", "आपले भाडे स्वतः ठरवा. चालक ते स्वीकारू किंवा नाकारू शकतात, पण बदलू शकत नाहीत."],
    "Your fare for this ride (₹)": ["इस राइड के लिए आपका किराया (₹)", "या राइडसाठी आपले भाडे (₹)"],
    "How will you pay?": ["आप भुगतान कैसे करेंगे?", "आपण पैसे कसे द्याल?"],
    "Cash": ["नकद", "रोख"],
    "Pay the driver in cash": ["ड्राइवर को नकद दें", "चालकाला रोख द्या"],
    "GPay, PhonePe, Paytm, BHIM or any UPI app": ["GPay, PhonePe, Paytm, BHIM या कोई भी UPI ऐप", "GPay, PhonePe, Paytm, BHIM किंवा कोणतेही UPI ॲप"],
    "Card": ["कार्ड", "कार्ड"],
    "Debit or credit card, if the driver has a card machine": ["डेबिट या क्रेडिट कार्ड, अगर ड्राइवर के पास कार्ड मशीन हो", "डेबिट किंवा क्रेडिट कार्ड, चालकाकडे कार्ड मशीन असल्यास"],
    "Payment is free. The site takes no fee and never handles your money. You pay the driver directly after the ride.": ["भुगतान मुफ़्त है। साइट कोई शुल्क नहीं लेती और आपका पैसा कभी नहीं संभालती। राइड के बाद आप सीधे ड्राइवर को भुगतान करते हैं।", "पैसे देणे विनामूल्य आहे. साइट कोणतेही शुल्क घेत नाही आणि आपले पैसे कधीही हाताळत नाही. राइडनंतर आपण थेट चालकाला पैसे देता."],
    "Ride insurance": ["राइड बीमा", "राइड विमा"],
    "Recommended": ["सुझाया गया", "शिफारस केलेले"],
    "We recommend insuring every ride. Choose a cover, or choose \"No insurance\".": ["हम हर राइड का बीमा कराने की सलाह देते हैं। कोई कवर चुनें, या \"कोई बीमा नहीं\" चुनें।", "प्रत्येक राइडचा विमा घ्यावा अशी आमची शिफारस आहे. एखादे कवच निवडा, किंवा \"विमा नको\" निवडा."],
    "No insurance": ["कोई बीमा नहीं", "विमा नको"],
    "I will ride without insurance": ["मैं बिना बीमा के यात्रा करूँगा/करूँगी", "मी विम्याशिवाय प्रवास करेन"],
    "₹{price} per ride": ["प्रति राइड ₹{price}", "प्रति राइड ₹{price}"],
    "Find {v} driver": ["{v} ड्राइवर खोजें", "{v} चालक शोधा"],
    "Set your pickup place": ["पिकअप की जगह चुनें", "पिकअपचे ठिकाण निवडा"],
    "Set your drop place": ["ड्रॉप की जगह चुनें", "उतरण्याचे ठिकाण निवडा"],
    "Enter your fare": ["अपना किराया डालें", "आपले भाडे टाका"],
    "Choose how you will pay": ["भुगतान का तरीका चुनें", "पैसे देण्याची पद्धत निवडा"],
    "Choose a ride cover or No insurance": ["राइड कवर या \"कोई बीमा नहीं\" चुनें", "राइड कवच किंवा \"विमा नको\" निवडा"],
    "Tick both boxes": ["दोनों बॉक्स पर टिक करें", "दोन्ही चौकटींवर खूण करा"],

    // ride status
    "Searching": ["खोज रहे हैं", "शोधत आहोत"],
    "Driver coming": ["ड्राइवर आ रहा है", "चालक येत आहे"],
    "On the way": ["रास्ते में", "प्रवासात"],
    "Done": ["पूरा", "पूर्ण"],
    "requested": ["अनुरोध भेजा", "विनंती केली"],
    "accepted": ["स्वीकार", "स्वीकारली"],
    "started": ["शुरू", "सुरू"],
    "completed": ["पूरी", "पूर्ण"],
    "cancelled": ["रद्द", "रद्द"],
    "Finding you a driver…": ["आपके लिए ड्राइवर खोज रहे हैं…", "आपल्यासाठी चालक शोधत आहोत…"],
    "Your driver is on the way": ["आपका ड्राइवर रास्ते में है", "आपला चालक येत आहे"],
    "Enjoy your ride": ["राइड का आनंद लें", "प्रवासाचा आनंद घ्या"],
    "From": ["कहाँ से", "कुठून"],
    "To": ["कहाँ तक", "कुठे"],
    "Payment": ["भुगतान", "पेमेंट"],
    "{m}, directly to the driver after the ride": ["{m}, राइड के बाद सीधे ड्राइवर को", "{m}, राइडनंतर थेट चालकाला"],
    "Insurance": ["बीमा", "विमा"],
    "Not insured": ["बीमा नहीं", "विमा नाही"],
    "Vehicle no.": ["वाहन नंबर", "वाहन क्रमांक"],
    "Arrives in": ["पहुँचने में", "पोहोचण्यास"],
    "Driver's undertaking": ["ड्राइवर का वचन", "चालकाचे हमीपत्र"],
    "Tell your driver this OTP to start the ride": ["राइड शुरू करने के लिए ड्राइवर को यह OTP बताएँ", "राइड सुरू करण्यासाठी चालकाला हा OTP सांगा"],
    "Nearby {v} drivers can see your request now.": ["पास के {v} ड्राइवर अब आपका अनुरोध देख सकते हैं।", "जवळचे {v} चालक आता आपली विनंती पाहू शकतात."],
    "Cancel ride": ["राइड रद्द करें", "राइड रद्द करा"],
    "₹{f}, decided by passenger": ["₹{f}, यात्री द्वारा तय", "₹{f}, प्रवाशाने ठरवलेले"],
    "{km} km away · about {min} min": ["{km} किमी दूर · लगभग {min} मिनट", "{km} किमी दूर · सुमारे {min} मिनिटे"],

    // paying
    "Pay your driver": ["अपने ड्राइवर को भुगतान करें", "आपल्या चालकाला पैसे द्या"],
    "Pay by": ["भुगतान का तरीका", "पेमेंट पद्धत"],
    "Scan with any UPI app, or pay to:": ["किसी भी UPI ऐप से स्कैन करें, या इस पर भुगतान करें:", "कोणत्याही UPI ॲपने स्कॅन करा, किंवा येथे पैसे पाठवा:"],
    "Copy UPI ID": ["UPI ID कॉपी करें", "UPI ID कॉपी करा"],
    "Open UPI app": ["UPI ऐप खोलें", "UPI ॲप उघडा"],
    "This driver hasn't added a UPI ID. Ask them for their UPI number or QR code.": ["इस ड्राइवर ने UPI ID नहीं जोड़ी है। उनसे UPI नंबर या QR कोड माँगें।", "या चालकाने UPI ID जोडलेला नाही. त्यांच्याकडे UPI नंबर किंवा QR कोड मागा."],
    "Pay ₹{f} in cash.": ["₹{f} नकद दें।", "₹{f} रोख द्या."],
    "Pay ₹{f} on the driver's card machine.": ["ड्राइवर की कार्ड मशीन पर ₹{f} का भुगतान करें।", "चालकाच्या कार्ड मशीनवर ₹{f} भरा."],
    "I have paid ₹{f}": ["मैंने ₹{f} दे दिए", "मी ₹{f} दिले"],
    "Copied": ["कॉपी हो गया", "कॉपी झाले"],
    "Select the ID": ["ID चुनें", "ID निवडा"],

    // suggest a place
    "For example your housing society, club or office. The site owner checks it before it appears for everyone.": ["जैसे आपकी हाउसिंग सोसाइटी, क्लब या दफ़्तर। सबको दिखने से पहले साइट के मालिक इसकी जाँच करते हैं।", "उदा. आपली हाउसिंग सोसायटी, क्लब किंवा कार्यालय. सर्वांना दिसण्यापूर्वी साइटचे मालक ते तपासतात."],
    "Name of the place": ["जगह का नाम", "ठिकाणाचे नाव"],
    "Kind": ["प्रकार", "प्रकार"],
    "Housing society": ["हाउसिंग सोसाइटी", "हाउसिंग सोसायटी"],
    "Club": ["क्लब", "क्लब"],
    "Government office": ["सरकारी दफ़्तर", "सरकारी कार्यालय"],
    "Court": ["अदालत", "न्यायालय"],
    "Government hospital": ["सरकारी अस्पताल", "सरकारी रुग्णालय"],
    "Private hospital": ["निजी अस्पताल", "खाजगी रुग्णालय"],
    "Station or bus stand": ["स्टेशन या बस अड्डा", "स्टेशन किंवा बस स्थानक"],
    "Other": ["अन्य", "इतर"],
    "State": ["राज्य", "राज्य"],
    "District": ["ज़िला", "जिल्हा"],
    "Taluka": ["तालुका", "तालुका"],
    "Location: we use your current pickup point.": ["स्थान: हम आपकी मौजूदा पिकअप जगह का उपयोग करते हैं।", "स्थान: आम्ही आपले सध्याचे पिकअप ठिकाण वापरतो."],
    "Set the pickup on the map first if it's somewhere else.": ["अगर जगह कहीं और है, तो पहले नक्शे पर पिकअप चुनें।", "ठिकाण दुसरीकडे असल्यास आधी नकाशावर पिकअप निवडा."],
    "Send suggestion": ["सुझाव भेजें", "सूचना पाठवा"],
    "Set a pickup point or use your current location first.": ["पहले पिकअप की जगह चुनें या अपनी लोकेशन लें।", "आधी पिकअप ठिकाण निवडा किंवा आपले लोकेशन वापरा."],
    "Thank you. The place will appear once the owner approves it.": ["धन्यवाद। मालिक की मंज़ूरी के बाद जगह दिखने लगेगी।", "धन्यवाद. मालकांनी मंजुरी दिल्यावर ठिकाण दिसू लागेल."],

    // railway stations
    "Pick me up at a railway station": ["रेलवे स्टेशन से पिकअप", "रेल्वे स्टेशनवरून पिकअप"],
    "Drop me at a railway station": ["मुझे रेलवे स्टेशन पर छोड़ें", "मला रेल्वे स्टेशनवर सोडा"],
    "Search station or city…": ["स्टेशन या शहर खोजें…", "स्टेशन किंवा शहर शोधा…"],
    "Which exit or platform? (optional)": ["कौन-सा गेट या प्लेटफ़ॉर्म? (वैकल्पिक)", "कोणते गेट किंवा प्लॅटफॉर्म? (ऐच्छिक)"],
    "e.g. Platform 1, main exit": ["जैसे प्लेटफ़ॉर्म 1, मुख्य गेट", "उदा. प्लॅटफॉर्म 1, मुख्य गेट"],
    "Maharashtra": ["महाराष्ट्र", "महाराष्ट्र"],
    "Other states": ["अन्य राज्य", "इतर राज्ये"],
    "Finding the station on the map…": ["नक्शे पर स्टेशन खोज रहे हैं…", "नकाशावर स्टेशन शोधत आहोत…"],
    "Check the pin on the map. Use Tap on map to move it if needed.": ["नक्शे पर पिन जाँच लें। ज़रूरत हो तो \"नक्शे पर टैप करें\" से जगह बदलें।", "नकाशावरील पिन तपासा. गरज असल्यास \"नकाशावर टॅप करा\" वापरून बदला."],
    "Mumbai local, Metro and Monorail stations: type the name in the pickup box.": ["मुंबई लोकल, मेट्रो और मोनोरेल स्टेशन: पिकअप बॉक्स में नाम लिखें।", "मुंबई लोकल, मेट्रो आणि मोनोरेल स्टेशन: पिकअप चौकटीत नाव लिहा."],
    "No station found. Try another spelling.": ["कोई स्टेशन नहीं मिला। दूसरी स्पेलिंग से खोजें।", "स्टेशन सापडले नाही. दुसरे स्पेलिंग वापरून पहा."],

    // driver
    "Waiting for approval": ["मंज़ूरी का इंतज़ार", "मंजुरीची प्रतीक्षा"],
    "Blocked": ["रोका गया", "अवरोधित"],
    "Online": ["ऑनलाइन", "ऑनलाइन"],
    "Offline": ["ऑफ़लाइन", "ऑफलाइन"],
    "Not added": ["नहीं जोड़ा", "जोडलेले नाही"],
    "Today": ["आज", "आज"],
    "{n} rides · ₹{e} earned, all yours": ["{n} राइड · ₹{e} कमाए, सब आपके", "{n} राइड · ₹{e} कमाई, सगळी आपली"],
    "The site owner will check your details and approve your account. You can go online after that.": ["साइट के मालिक आपकी जानकारी जाँचकर आपका खाता मंज़ूर करेंगे। उसके बाद आप ऑनलाइन हो सकते हैं।", "साइटचे मालक आपली माहिती तपासून खाते मंजूर करतील. त्यानंतर आपण ऑनलाइन होऊ शकता."],
    "Go offline": ["ऑफ़लाइन हों", "ऑफलाइन व्हा"],
    "Go online": ["ऑनलाइन हों", "ऑनलाइन व्हा"],
    "Edit my details": ["मेरी जानकारी बदलें", "माझी माहिती बदला"],
    "Ride requests ({n})": ["राइड अनुरोध ({n})", "राइड विनंत्या ({n})"],
    "{km} km from you": ["आपसे {km} किमी", "आपल्यापासून {km} किमी"],
    "trip about {km} km": ["यात्रा लगभग {km} किमी", "प्रवास सुमारे {km} किमी"],
    "pays by {m}": ["{m} से भुगतान", "{m} ने पैसे"],
    "Fare decided by the passenger. You can accept or decline it, but not change it.": ["किराया यात्री ने तय किया है। आप इसे मान या ठुकरा सकते हैं, बदल नहीं सकते।", "भाडे प्रवाशाने ठरवले आहे. आपण ते स्वीकारू किंवा नाकारू शकता, बदलू शकत नाही."],
    "Accept": ["स्वीकार करें", "स्वीकारा"],
    "No requests right now. New ones appear here automatically.": ["अभी कोई अनुरोध नहीं। नए अनुरोध यहाँ अपने-आप दिखेंगे।", "सध्या विनंती नाही. नवीन विनंत्या येथे आपोआप दिसतील."],
    "Waiting for payment": ["भुगतान का इंतज़ार", "पेमेंटची प्रतीक्षा"],
    "Payment received": ["भुगतान मिल गया", "पेमेंट मिळाले"],
    "Edit driver details": ["ड्राइवर की जानकारी बदलें", "चालकाची माहिती बदला"],
    "Drive with myrightmyride": ["myrightmyride के साथ गाड़ी चलाएँ", "myrightmyride सोबत गाडी चालवा"],
    "No commission. You keep everything the passenger pays.": ["कोई कमीशन नहीं। यात्री जो देता है, सब आपका।", "कमिशन नाही. प्रवासी जे देतो ते सगळे आपले."],
    "Vehicle type": ["वाहन का प्रकार", "वाहनाचा प्रकार"],
    "Vehicle number": ["वाहन नंबर", "वाहन क्रमांक"],
    "Driving licence number": ["ड्राइविंग लाइसेंस नंबर", "वाहन परवाना क्रमांक"],
    "Your UPI ID (optional)": ["आपकी UPI ID (वैकल्पिक)", "आपला UPI ID (ऐच्छिक)"],
    "Pick up {n}": ["{n} को पिकअप करें", "{n} यांना पिकअप करा"],
    "Drop {n}": ["{n} को छोड़ें", "{n} यांना सोडा"],
    "Pickup": ["पिकअप", "पिकअप"],
    "Drop": ["ड्रॉप", "उतरणे"],
    "Collect": ["लेना है", "घ्यायचे"],
    "{f}, paid by {m} after the ride": ["{f}, राइड के बाद {m} से", "{f}, राइडनंतर {m} ने"],
    "Distance": ["दूरी", "अंतर"],
    "Directions on OpenStreetMap": ["OpenStreetMap पर रास्ता", "OpenStreetMap वर मार्ग"],
    "Ask the passenger for their 4-digit OTP": ["यात्री से 4 अंकों का OTP पूछें", "प्रवाशाला 4 अंकी OTP विचारा"],
    "Start ride": ["राइड शुरू करें", "राइड सुरू करा"],
    "Cancel pickup": ["पिकअप रद्द करें", "पिकअप रद्द करा"],
    "Fare shown on your meter (₹)": ["आपके मीटर पर दिखा किराया (₹)", "आपल्या मीटरवर दिसणारे भाडे (₹)"],
    "Complete ride": ["राइड पूरी करें", "राइड पूर्ण करा"],
    "Allow location so passengers can see you coming.": ["लोकेशन की अनुमति दें ताकि यात्री आपको आते देख सकें।", "लोकेशनला परवानगी द्या, म्हणजे प्रवाशांना आपण येताना दिसाल."],
    "Waiting for GPS…": ["GPS का इंतज़ार…", "GPS ची प्रतीक्षा…"],

    // timeline
    "Your timeline": ["आपकी टाइमलाइन", "आपली टाइमलाइन"],
    "Your finished rides will appear here, day by day, with the route each one took.": ["आपकी पूरी हुई राइड यहाँ दिन-ब-दिन, रास्ते के साथ दिखेंगी।", "आपल्या पूर्ण झालेल्या राइड येथे दिवसानुसार, मार्गासह दिसतील."],
    "Tap a ride to see its route on the map.": ["नक्शे पर रास्ता देखने के लिए राइड पर टैप करें।", "नकाशावर मार्ग पाहण्यासाठी राइडवर टॅप करा."],
    "No driver": ["कोई ड्राइवर नहीं", "चालक नाही"],
    "meter": ["मीटर", "मीटर"],
    "fixed": ["तय", "ठरलेले"],
    "paid": ["भुगतान हुआ", "पैसे दिले"],
    "unpaid": ["भुगतान बाकी", "पैसे बाकी"],
    "Cancelled": ["रद्द", "रद्द"],

    // complaints
    "Help and complaints": ["सहायता और शिकायत", "मदत आणि तक्रार"],
    "Had a problem? Raise a complaint and get a ticket number. We reply here.": ["कोई समस्या? शिकायत दर्ज करें और टिकट नंबर पाएँ। जवाब यहीं मिलेगा।", "काही अडचण? तक्रार नोंदवा आणि तिकीट क्रमांक मिळवा. उत्तर इथेच मिळेल."],
    "Raise a complaint": ["शिकायत दर्ज करें", "तक्रार नोंदवा"],
    "What is it about?": ["शिकायत किस बारे में है?", "तक्रार कशाबद्दल आहे?"],
    "Driver's behaviour": ["ड्राइवर का व्यवहार", "चालकाचे वर्तन"],
    "Passenger's behaviour": ["यात्री का व्यवहार", "प्रवाशाचे वर्तन"],
    "Fare or overcharging": ["किराया या ज़्यादा वसूली", "भाडे किंवा जास्त आकारणी"],
    "Safety": ["सुरक्षा", "सुरक्षा"],
    "Vehicle condition": ["वाहन की हालत", "वाहनाची स्थिती"],
    "Lost item": ["खोया हुआ सामान", "हरवलेली वस्तू"],
    "Website problem": ["वेबसाइट की समस्या", "वेबसाइटची अडचण"],
    "Which ride? (optional)": ["कौन-सी राइड? (वैकल्पिक)", "कोणती राइड? (ऐच्छिक)"],
    "Not about a ride": ["किसी राइड के बारे में नहीं", "राइडबद्दल नाही"],
    "Describe the problem": ["समस्या बताएँ", "अडचण सांगा"],
    "Submit complaint": ["शिकायत भेजें", "तक्रार पाठवा"],
    "Complaint registered. Your ticket number is {t}.": ["शिकायत दर्ज हो गई। आपका टिकट नंबर {t} है।", "तक्रार नोंदवली. आपला तिकीट क्रमांक {t} आहे."],
    "Your complaints": ["आपकी शिकायतें", "आपल्या तक्रारी"],
    "Open": ["दर्ज", "नोंदवली"],
    "Being looked into": ["जाँच जारी है", "तपास सुरू आहे"],
    "Resolved": ["हल हो गई", "निकाली निघाली"],
    "Closed": ["बंद", "बंद"],
    "Reply": ["जवाब", "उत्तर"],
    "Ride: {r}": ["राइड: {r}", "राइड: {r}"],
    "Update on your complaint {t}": ["आपकी शिकायत {t} पर अपडेट", "आपल्या तक्रार {t} वर अपडेट"],
    "Complaints can be raised after you log in.": ["लॉग इन करने के बाद शिकायत दर्ज की जा सकती है।", "लॉग इन केल्यानंतर तक्रार नोंदवता येते."],

    // place lists and search (places.js)
    "Search could not reach the map service. Check your internet connection.": ["खोज मैप सेवा तक नहीं पहुँच सकी। इंटरनेट कनेक्शन जाँचें।", "शोध नकाशा सेवेपर्यंत पोहोचू शकला नाही. इंटरनेट कनेक्शन तपासा."],
    "Couldn't find that place on the map. Try typing it differently.": ["वह जगह नक्शे पर नहीं मिली। अलग तरह से लिखकर देखें।", "ते ठिकाण नकाशावर सापडले नाही. वेगळ्या प्रकारे लिहून पहा."],
    "Kind of place": ["जगह का प्रकार", "ठिकाणाचा प्रकार"],
    "Choose state": ["राज्य चुनें", "राज्य निवडा"],
    "Choose district": ["ज़िला चुनें", "जिल्हा निवडा"],
    "Whole district": ["पूरा ज़िला", "संपूर्ण जिल्हा"],
    "Show places": ["जगहें दिखाएँ", "ठिकाणे दाखवा"],
    "Filter by name…": ["नाम से छाँटें…", "नावाने शोधा…"],
    "Loading districts…": ["ज़िले लोड हो रहे हैं…", "जिल्हे लोड होत आहेत…"],
    "Could not load districts right now. Please try again in a minute.": ["अभी ज़िले लोड नहीं हो सके। एक मिनट बाद फिर कोशिश करें।", "सध्या जिल्हे लोड झाले नाहीत. एका मिनिटाने पुन्हा प्रयत्न करा."],
    "Loading talukas…": ["तालुके लोड हो रहे हैं…", "तालुके लोड होत आहेत…"],
    "Could not load talukas. You can still search the whole district.": ["तालुके लोड नहीं हो सके। आप फिर भी पूरे ज़िले में खोज सकते हैं।", "तालुके लोड झाले नाहीत. तरीही आपण संपूर्ण जिल्ह्यात शोधू शकता."],
    "Choose a state and a district first.": ["पहले राज्य और ज़िला चुनें।", "आधी राज्य आणि जिल्हा निवडा."],
    "Loading…": ["लोड हो रहा है…", "लोड होत आहे…"],
    "{n} found in {w}.": ["{w} में {n} मिले।", "{w} मध्ये {n} सापडले."],
    "Could not load places right now. The map server may be busy. Please try again in a minute.": ["अभी जगहें लोड नहीं हो सकीं। मैप सर्वर व्यस्त हो सकता है। एक मिनट बाद फिर कोशिश करें।", "सध्या ठिकाणे लोड झाली नाहीत. नकाशा सर्व्हर व्यस्त असू शकतो. एका मिनिटाने पुन्हा प्रयत्न करा."],
    "Nothing found. Places not yet on OpenStreetMap won't appear. You can suggest a missing place from the booking screen.": ["कुछ नहीं मिला। जो जगहें अभी OpenStreetMap पर नहीं हैं, वे नहीं दिखेंगी। बुकिंग स्क्रीन से आप छूटी जगह सुझा सकते हैं।", "काहीही सापडले नाही. OpenStreetMap वर नसलेली ठिकाणे दिसणार नाहीत. बुकिंग स्क्रीनवरून आपण राहिलेले ठिकाण सुचवू शकता."],
    "Added on myrightmyride": ["myrightmyride पर जोड़ा गया", "myrightmyride वर जोडलेले"],
    "Government": ["सरकारी", "सरकारी"],
    "Private": ["निजी", "खाजगी"],
    "Railway stations and bus stands": ["रेलवे स्टेशन और बस अड्डे", "रेल्वे स्टेशन आणि बस स्थानके"],
    "Courts (High Court, District, Taluka)": ["अदालतें (हाई कोर्ट, ज़िला, तालुका)", "न्यायालये (उच्च न्यायालय, जिल्हा, तालुका)"],
    "Collector, Tahsildar, SDO and govt offices": ["कलेक्टर, तहसीलदार, SDO और सरकारी दफ़्तर", "जिल्हाधिकारी, तहसीलदार, उपविभागीय अधिकारी आणि सरकारी कार्यालये"],
    "Government / public hospitals": ["सरकारी अस्पताल", "सरकारी रुग्णालये"],
    "Private hospitals and clinics": ["निजी अस्पताल और क्लिनिक", "खाजगी रुग्णालये आणि दवाखाने"],
    "Housing societies": ["हाउसिंग सोसाइटी", "गृहनिर्माण संस्था"],
    "Clubs and gymkhanas": ["क्लब और जिमखाने", "क्लब आणि जिमखाने"],
    "Temples and religious places": ["मंदिर और धार्मिक स्थल", "मंदिरे आणि धार्मिक स्थळे"],
    "Schools and colleges": ["स्कूल और कॉलेज", "शाळा आणि महाविद्यालये"],
    "Markets and malls": ["बाज़ार और मॉल", "बाजार आणि मॉल"],
    "Tourist spots and parks": ["पर्यटन स्थल और पार्क", "पर्यटन स्थळे आणि उद्याने"],

    // coming soon page
    "Coming soon": ["जल्द आ रहा है", "लवकरच येत आहे"],
    "Book a bike, auto or car from anywhere, with no commission from drivers or passengers.": ["कहीं से भी बाइक, ऑटो या कार बुक करें, ड्राइवर या यात्री से कोई कमीशन नहीं।", "कुठूनही बाईक, रिक्षा किंवा कार बुक करा, चालक किंवा प्रवाशांकडून कोणतेही कमिशन नाही."],
    "Pay the driver directly, as per the vehicle's own meter, by cash, UPI or card. The site never takes a fee.": ["वाहन के अपने मीटर के अनुसार, सीधे ड्राइवर को नकद, UPI या कार्ड से भुगतान करें। साइट कभी कोई शुल्क नहीं लेती।", "वाहनाच्या स्वतःच्या मीटरप्रमाणे थेट चालकाला रोख, UPI किंवा कार्डने पैसे द्या. साइट कधीही शुल्क घेत नाही."],

    // default owner-panel texts (used only while the owner has not changed them)
    "Bike": ["बाइक", "बाईक"],
    "Auto": ["ऑटो", "रिक्षा"],
    "Car": ["कार", "कार"],
    "Bike · Auto · Car. No commission from drivers or passengers.": ["बाइक · ऑटो · कार। ड्राइवर या यात्री से कोई कमीशन नहीं।", "बाईक · रिक्षा · कार. चालक किंवा प्रवाशांकडून कमिशन नाही."],
    "myrightmyride.com takes no commission from drivers or passengers. The final fare is what the vehicle's own meter shows, or the fare the passenger decides at booking, and you pay the driver directly by cash, UPI (GPay, PhonePe, Paytm or any UPI app) or card after the ride. Payments are free: the site never takes a fee or handles your money.":
      ["myrightmyride.com ड्राइवरों या यात्रियों से कोई कमीशन नहीं लेती। अंतिम किराया वही है जो वाहन का अपना मीटर दिखाए, या जो किराया यात्री बुकिंग के समय तय करे, और आप राइड के बाद सीधे ड्राइवर को नकद, UPI (GPay, PhonePe, Paytm या कोई भी UPI ऐप) या कार्ड से भुगतान करते हैं। भुगतान मुफ़्त है: साइट कभी शुल्क नहीं लेती और आपका पैसा नहीं संभालती।",
       "myrightmyride.com चालक किंवा प्रवाशांकडून कोणतेही कमिशन घेत नाही. अंतिम भाडे म्हणजे वाहनाचे स्वतःचे मीटर दाखवेल ते, किंवा बुकिंगच्या वेळी प्रवाशाने ठरवलेले भाडे, आणि राइडनंतर आपण थेट चालकाला रोख, UPI (GPay, PhonePe, Paytm किंवा कोणतेही UPI ॲप) किंवा कार्डने पैसे देता. पेमेंट विनामूल्य आहे: साइट कधीही शुल्क घेत नाही किंवा आपले पैसे हाताळत नाही."],
    "myrightmyride.com is a citizens' initiative operated by {operator}. It is not approved by, or connected with, any government body.":
      ["myrightmyride.com एक नागरिक पहल है, जिसका संचालन {operator} करती है। इसे किसी भी सरकारी संस्था की मंज़ूरी नहीं है, और न ही इसका किसी सरकारी संस्था से संबंध है।",
       "myrightmyride.com हा नागरिकांचा उपक्रम आहे, जो {operator} चालवते. याला कोणत्याही सरकारी संस्थेची मान्यता नाही, आणि त्याचा कोणत्याही सरकारी संस्थेशी संबंध नाही."],
    "Your safety is your own responsibility. Before choosing a ride, take care to protect yourself against theft, injury or other harm. We recommend insuring every ride, either with the optional ride cover offered at booking by our partner insurers or with your own accident and personal insurance. myrightmyride.com only connects passengers and drivers.":
      ["आपकी सुरक्षा आपकी अपनी ज़िम्मेदारी है। राइड चुनने से पहले चोरी, चोट या किसी अन्य नुकसान से खुद को बचाने का ध्यान रखें। हम हर राइड का बीमा कराने की सलाह देते हैं, या तो बुकिंग के समय हमारी साझेदार बीमा कंपनियों के वैकल्पिक राइड कवर से, या अपने खुद के दुर्घटना और व्यक्तिगत बीमा से। myrightmyride.com केवल यात्रियों और ड्राइवरों को जोड़ती है।",
       "आपली सुरक्षा ही आपली स्वतःची जबाबदारी आहे. राइड निवडण्यापूर्वी चोरी, दुखापत किंवा इतर कोणत्याही हानीपासून स्वतःचे संरक्षण करण्याची काळजी घ्या. प्रत्येक राइडचा विमा घ्यावा अशी आमची शिफारस आहे, एकतर बुकिंगच्या वेळी आमच्या भागीदार विमा कंपन्यांच्या ऐच्छिक राइड कवचाद्वारे किंवा आपल्या स्वतःच्या अपघात आणि वैयक्तिक विम्याद्वारे. myrightmyride.com फक्त प्रवासी आणि चालकांना जोडते."],
    "I understand that my safety is my own responsibility. Before choosing a ride I will take care to protect myself against theft, injury or other harm, and I have been advised to insure my ride.":
      ["मैं समझता/समझती हूँ कि मेरी सुरक्षा मेरी अपनी ज़िम्मेदारी है। राइड चुनने से पहले मैं चोरी, चोट या अन्य नुकसान से खुद को बचाने का ध्यान रखूँगा/रखूँगी, और मुझे अपनी राइड का बीमा कराने की सलाह दी गई है।",
       "माझी सुरक्षा ही माझी स्वतःची जबाबदारी आहे हे मला समजते. राइड निवडण्यापूर्वी मी चोरी, दुखापत किंवा इतर हानीपासून स्वतःचे संरक्षण करण्याची काळजी घेईन, आणि मला माझ्या राइडचा विमा घेण्याचा सल्ला देण्यात आला आहे."],
    "I am booking this ride and undertake to pay the charges as per the vehicle's meter directly to the driver.":
      ["मैं यह राइड बुक कर रहा/रही हूँ और वाहन के मीटर के अनुसार किराया सीधे ड्राइवर को देने का वचन देता/देती हूँ।",
       "मी ही राइड बुक करत आहे आणि वाहनाच्या मीटरप्रमाणे भाडे थेट चालकाला देण्याची हमी देतो/देते."],
    "I am booking this ride and undertake to pay the fare I have decided directly to the driver.":
      ["मैं यह राइड बुक कर रहा/रही हूँ और अपने तय किए गए किराए को सीधे ड्राइवर को देने का वचन देता/देती हूँ।",
       "मी ही राइड बुक करत आहे आणि मी ठरवलेले भाडे थेट चालकाला देण्याची हमी देतो/देते."],
    "I undertake to charge passengers only as per my vehicle's meter, or the fare decided by the passenger, and within the permissible fare limits.":
      ["मैं वचन देता/देती हूँ कि यात्रियों से केवल अपने वाहन के मीटर के अनुसार, या यात्री द्वारा तय किए गए किराए के अनुसार, और अनुमत किराया सीमा के भीतर ही शुल्क लूँगा/लूँगी।",
       "मी हमी देतो/देते की प्रवाशांकडून फक्त माझ्या वाहनाच्या मीटरप्रमाणे, किंवा प्रवाशाने ठरवलेल्या भाड्याप्रमाणे, आणि परवानगी असलेल्या भाडे मर्यादेतच शुल्क आकारेन."],
    "Plans, prices and cover amounts are being finalised with licensed partner insurers. No payment is taken here.":
      ["प्लान, कीमतें और कवर की राशि लाइसेंस प्राप्त साझेदार बीमा कंपनियों के साथ तय की जा रही हैं। यहाँ कोई भुगतान नहीं लिया जाता।",
       "योजना, किमती आणि विमा रक्कम परवानाधारक भागीदार विमा कंपन्यांसोबत निश्चित केल्या जात आहेत. येथे कोणतेही पैसे घेतले जात नाहीत."],
    "Basic ride cover": ["बेसिक राइड कवर", "बेसिक राइड कवच"],
    "Plus ride cover": ["प्लस राइड कवर", "प्लस राइड कवच"],
    "Accident cover for this ride. Details coming soon.": ["इस राइड के लिए दुर्घटना कवर। जानकारी जल्द आएगी।", "या राइडसाठी अपघात विमा. तपशील लवकरच."],
    "Accident cover plus theft of belongings. Details coming soon.": ["दुर्घटना कवर और सामान की चोरी का कवर। जानकारी जल्द आएगी।", "अपघात विमा आणि सामान चोरीचे कवच. तपशील लवकरच."],
  };

  const pick = () => {
    let l = null;
    try { l = localStorage.getItem("mrmr.lang"); } catch { /* private mode */ }
    if (LANGS[l]) return l;
    const n = (navigator.language || "").toLowerCase();
    return n.startsWith("mr") ? "mr" : n.startsWith("hi") ? "hi" : "en";
  };
  let lang = pick();
  const col = () => (lang === "hi" ? 0 : 1);
  const fill = (s, vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : s);

  // Translate a fixed piece of the website. vars fill {name} parts.
  function t(s, vars) {
    const e = lang !== "en" && D[s];
    return fill(e ? e[col()] || s : s, vars);
  }
  // Translate a text that the owner can edit in the owner panel; only the original default wording has translations.
  function tText(s, operator) {
    if (!s || lang === "en") return s;
    const key = operator ? s.split(operator).join("{operator}") : s;
    const e = D[key];
    return e ? e[col()].split("{operator}").join(operator || "") : s;
  }
  function setLang(l) {
    if (!LANGS[l]) return;
    lang = l;
    try { localStorage.setItem("mrmr.lang", l); } catch { /* private mode */ }
    document.documentElement.lang = l;
  }
  // Fill elements marked data-i18n="English text" in the page itself.
  function applyStatic(root = document) {
    root.querySelectorAll("[data-i18n]").forEach(el => (el.textContent = t(el.dataset.i18n)));
  }
  // A language picker <select>; onChange runs after switching.
  function picker(sel, onChange) {
    sel.innerHTML = Object.entries(LANGS).map(([k, v]) => `<option value="${k}" ${k === lang ? "selected" : ""}>${v}</option>`).join("");
    sel.onchange = () => { setLang(sel.value); applyStatic(); onChange && onChange(); };
  }
  document.documentElement.lang = lang;
  window.I18N = { t, tText, setLang, applyStatic, picker, get lang() { return lang; }, LANGS, _dict: D };
})();
