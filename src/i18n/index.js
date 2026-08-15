/**
 * Two languages, one dictionary.
 *
 * Greek is the language this was built in and English is the one it will be
 * shown in, so both are first class: every string a viewer can read lives here,
 * in both, and `t('some.key')` is the only way to get one.
 *
 *   import { t, setLanguage, onLanguageChange } from '../i18n/index.js'
 *   t('menu.play')
 *
 * Two of the tables are keyed by something other than a sentence, on purpose:
 *
 *   field.<key>   the label of a slider, so the modules that own the sliders
 *                 (the mixer, the picture, the venues) do not each need their
 *                 own translation code. `translateField()` swaps the label on
 *                 the way to the panel, in one place.
 *   venue.<id>, view.<id>, preset.<key>, ratio.<key>   the same trick for the
 *                 rows of chips.
 *
 * A missing key returns the key itself rather than blank: a wrong label is a
 * bug you can see, an empty one is a bug you find later.
 */

const STORAGE_KEY = 'vc.lang'

export const LANGUAGES = {
  el: { code: 'el', label: 'Ελληνικά', short: 'ΕΛ' },
  en: { code: 'en', label: 'English', short: 'EN' },
}

const STRINGS = {
  el: {
    /* --- the dock ------------------------------------------------------- */
    'dock.venue': 'Χώρος',
    'dock.screen': 'Οθόνη',
    'dock.lights': 'Φώτα',
    'dock.sound': 'Ήχος',
    'dock.view': 'Θέα',
    'dock.queue': 'Ουρά',
    'dock.play': 'Παίξε',
    'dock.pause': 'Παύση',
    'dock.time': 'Χρόνος ταινίας',
    'dock.seek': 'Θέση ταινίας',
    'dock.badTime': 'Γράψε ώρα σαν 1:21:04',
    'dock.volume': 'Ένταση',
    'net.inRoom': 'στην αίθουσα',
    'net.mic': 'Μικρόφωνο',
    'net.micDenied': 'Χωρίς άδεια',
    'net.micMuted': 'Σε σίγαση',
    'net.micOn': 'Ανοιχτό',
    'dock.quality': 'Ποιότητα',
    'dock.clean': 'Καθαρή οθόνη · μόνο η ταινία',
    'dock.library': 'Βιβλιοθήκη',
    'library.loading': 'Φορτώνει το πρόγραμμα...',
    'library.empty': 'Δεν υπάρχει πρόγραμμα ακόμα.',
    'library.untitled': 'Χωρίς τίτλο',
    'library.hint': 'Διάλεξε ταινία από κάτω, μετά πάτα «Ξεκίνα» — παίζει για ΟΛΗ την αίθουσα.',
    'library.tonight': 'Απόψε στην αίθουσα',
    'library.startForAll': 'Ξεκίνα για όλη την αίθουσα',
    'library.minutes': 'λεπτά',
    'library.secondsShort': ' δευτ.',
    'library.byWhom': 'από',
    'library.byViews': 'Πιο δημοφιλή',
    'library.byLikes': 'Πιο αγαπημένα',
    'library.byLength': 'Μεγάλου μήκους',
    'library.films': 'ταινίες',
    'library.paused': 'Διάλειμμα · φώτα πάνω',
    'library.resumed': 'Συνεχίζουμε',
    'library.hold': 'Διάλειμμα',
    'library.resume': 'Συνέχισε',
    'dock.share': 'Μοιράσου την οθόνη σου με την αίθουσα',
    'dock.shareStop': 'Σταμάτα το μοίρασμα',
    'flash.shareOn': 'Η αίθουσα βλέπει την οθόνη σου',
    'flash.shareOff': 'Σταμάτησε το μοίρασμα',
    'flash.shareCancelled': 'Ακυρώθηκε',
    'flash.shareNoVideo': 'Δεν ήρθε εικόνα από το μοίρασμα',
    'group.saveLights': 'Κράτα τα τωρινά φώτα ως',
    'toggle.effects': 'Ήχοι του χώρου',
    'group.subtitles': 'Υπότιτλοι',
    'toggle.captions': 'Υπότιτλοι YouTube',
    'group.embedRoom': 'Ταινία από YouTube',
    'hint.embedRoom':
      'Η ταινία του YouTube παίζει στον δικό της player, οπότε η ηχώ και τα μπάσα της αίθουσας δεν την πιάνουν. Την πιάνει όμως η θέση σου: όσο απομακρύνεσαι ή γυρνάς την πλάτη, χαμηλώνει, όπως στην πραγματική αίθουσα.',
    'flash.captionsOn': 'Υπότιτλοι: ναι',
    'flash.captionsOff': 'Υπότιτλοι: όχι',
    'flash.cleanOn': 'Καθαρή οθόνη · L ή Esc για να επιστρέψεις',
    'menu.cleanOn': 'Καθαρή οθόνη',
    'menu.cleanOff': 'Φέρε πίσω τα χειριστήρια',
    'flash.savedLights': 'Αποθηκεύτηκε',
    'flash.effectsOn': 'Ήχοι του χώρου: ναι',
    'flash.effectsOff': 'Ήχοι του χώρου: όχι',

    /* --- groups --------------------------------------------------------- */
    'group.audience': 'Κοινό',
    'group.picture': 'Εικόνα',
    'group.bloom': 'Λάμψη',
    'group.show': 'Προβολή',
    'group.version': 'Έκδοση',
    'group.language': 'Γλώσσα',
    'group.next': 'Επόμενες ταινίες',
    'group.curtains': 'Κουρτίνες',
    'group.quality': 'Ποιότητα YouTube',
    'curtain.open': 'Ανοιχτές',
    'curtain.closed': 'Κλειστές',
    'quality.auto': 'Αυτόματη',
    'btn.reset': 'Επαναφορά',
    'btn.resetAll': 'Επαναφορά όλων',
    'tip.reset': 'Επαναφορά στην αρχική τιμή',

    /* --- buttons -------------------------------------------------------- */
    'btn.testSounds': 'Δοκιμή ήχων',
    'btn.startNow': 'Ξεκίνα αμέσως',
    'btn.whatsNew': 'Τι άλλαξε',
    'btn.clearQueue': 'Άδειασε την ουρά',
    'btn.remove': 'Βγάλ το',
    'btn.later': 'Αργότερα',
    'btn.update': 'Ενημέρωση',
    'btn.close': 'Κλείσιμο',

    /* --- toggles -------------------------------------------------------- */
    'toggle.cinematic': 'Κινηματογραφικό κάδρο (C)',
    'toggle.ceremony': 'Τελετή: φώτα και κουρτίνες',
    'toggle.yes': 'Ναι',
    'toggle.no': 'Όχι',

    /* --- the menu ------------------------------------------------------- */
    'menu.play': 'Παίξε',
    'menu.pause': 'Παύση',
    'menu.noFilm': 'χωρίς ταινία',
    'menu.openFilm': 'Άνοιξε ταινία...',
    'menu.next': 'Επόμενο στη λίστα',
    'menu.previous': 'Προηγούμενο',
    'menu.of': 'από',
    'menu.fullscreen': 'Πλήρης οθόνη',
    'menu.screenSize': 'Μέγεθος οθόνης',
    'menu.lights': 'Φώτα',
    'menu.view': 'Θέα',
    'menu.venue': 'Χώρος',
    'menu.leaveFrame': 'Έξοδος από το κάδρο',
    'menu.enterFrame': 'Κινηματογραφικό κάδρο',
    'menu.stand': 'Σήκω από τη θέση',
    'menu.sit': 'Κάθισε εδώ',
    'menu.dock': 'Μπάρα ελέγχου',
    'menu.enterRoom': 'Μπες στην αίθουσα',
    'menu.click': 'κλικ',
    'menu.updateNow': 'Ενημέρωση σε νέα έκδοση',
    'menu.whatsNew': 'Τι άλλαξε',

    /* --- captions ------------------------------------------------------- */
    'flash.houseLights': 'Φώτα αίθουσας',
    'flash.soundTest': 'Βήματα, κάθισμα, διακόπτης',
    'flash.enjoy': 'Καλή προβολή',
    'flash.interval': 'Διάλειμμα',
    'flash.filmOver': 'Τέλος προβολής',
    'flash.upNext': 'Ακολουθεί',
    'flash.queued': 'Μπήκε στην ουρά',
    'flash.crosshairOn': 'Σημάδι στη μέση: ναι',
    'flash.crosshairOff': 'Σημάδι στη μέση: όχι',

    /* --- the player ----------------------------------------------------- */
    'hud.keys':
      'W A S D κίνηση · Space άλμα · E κάθισμα · V θέες · C σινεμά · ρόδα ζουμ · Caps σημάδι · L μπάρα · Esc',
    'hud.enter': 'Κάνε κλικ για να μπεις στην αίθουσα',
    'hud.cinematic': 'Σινεμά · κλικ ή οποιοδήποτε πλήκτρο για έξοδο',
    'hud.firstPerson': 'Πρώτο πρόσωπο',
    'hud.nextView': 'V για την επόμενη',
    'hud.satDown': 'Κάθισες',
    'hud.stoodUp': 'Σηκώθηκες',
    'hud.seat': 'θέση',
    'hud.noSeat': 'Δεν υπάρχει ελεύθερη θέση εδώ κοντά',
    'hud.seatTaken': 'Η θέση είναι πιασμένη',

    /* --- the opening screen --------------------------------------------- */
    'start.kicker': 'Εικονικό σινεμά',
    'start.title': 'Η αίθουσα είναι έτοιμη',
    'start.sub': 'Μπες μέσα και βάλε ταινία όποτε θέλεις εσύ.',
    'start.cta': 'Μπες στην αίθουσα',
    'start.pick': 'Ή διάλεξε ταινία τώρα',
    'start.note': 'Ένα κλικ χρειάζεται, για να ανοίξει ο browser τον ήχο.',
    'start.pickFile': 'Διάλεξε ένα αρχείο βίντεο από τον υπολογιστή σου.',

    /* --- το φουαγιέ: όνομα και αίθουσα ---------------------------------- */
    'lobby.sub': 'Διάλεξε αίθουσα. Ό,τι παίζει εκεί, το βλέπετε όλοι μαζί.',
    'lobby.yourName': 'Το όνομά σου',
    'lobby.namePlaceholder': 'π.χ. ΑΛΕΞ',
    'lobby.hall': 'Αίθουσα',
    'lobby.enterHall': 'Μπες στην αίθουσα',
    'lobby.empty': 'άδεια',
    'lobby.full': 'γεμάτη',
    'lobby.person': 'άτομο',
    'lobby.people': 'άτομα',
    'lobby.nothingOn': 'Δεν παίζει κάτι',
    'lobby.aFilm': 'Παίζει ταινία',
    'lobby.justStarted': 'μόλις ξεκίνησε',
    'lobby.minutesIn': 'λεπτά μέσα',
    'lobby.note': 'Το όνομα κρατάει όσο η επίσκεψη. Μπαίνεις εκεί που είναι ήδη η ταινία.',
    'lobby.joinedAt': 'Μπήκες στο',
    'lobby.localOnly':
      '<b>Αυτή την ταινία τη βλέπεις μόνο εσύ.</b> Είναι αρχείο από τον υπολογιστή σου και οι άλλοι στην αίθουσα δεν μπορούν να το ανοίξουν. Για να τη δείτε μαζί, βάλε την από το <b>«Από link»</b> (YouTube ή Vimeo).',

    /* --- the source picker ---------------------------------------------- */
    'picker.open': 'Αρχείο από τον υπολογιστή (μόνο για σένα)',
    'picker.link': 'Από link',
    'picker.play': 'Παίξε',
    'picker.queue': 'Στην ουρά',
    'picker.url': 'Link YouTube, Vimeo ή αρχείο (mp4, webm)',
    'picker.hint': 'Βάλε link YouTube ή Vimeo και το βλέπει ΟΛΗ η αίθουσα, από το ίδιο σημείο.',
    'picker.needUrl': 'Βάλε πρώτα μια διεύθυνση βίντεο.',
    'picker.notVideo': 'Αυτό δεν είναι αρχείο βίντεο. Δοκίμασε MP4 ή WebM.',
    'picker.loading': 'Φορτώνω',
    'picker.drop': 'Άσε το βίντεο εδώ',
    'picker.dropNote': 'Παίζει αμέσως στη μεγάλη οθόνη',

    /* --- updates -------------------------------------------------------- */
    'update.title': 'Νέα έκδοση έτοιμη',
    'update.detail': 'Ενημέρωσε όποτε σε βολεύει.',
    'update.dev': 'Άλλαξε κάτι στον κώδικα. Ενημέρωσε όποτε θέλεις.',
    'update.version': 'Έκδοση',
    'update.changelog': 'Τι άλλαξε',
    'update.running': 'Τρέχεις την έκδοση',
    'update.loading': 'Φορτώνω...',
    'update.missing': 'Το αρχείο των αλλαγών δεν βρέθηκε.',

    /* --- the queue ------------------------------------------------------ */
    'queue.empty': 'Η ουρά είναι άδεια. Πρόσθεσε ταινίες από το «Άνοιξε ταινία».',
    'queue.now': 'Παίζει τώρα',
    'queue.waiting': 'Ακολουθεί σε',
    'queue.seconds': 'δευτ.',
    'queue.playNow': 'Παίξε το τώρα',
    'queue.skip': 'Πέρνα στο επόμενο',

    /* --- everything else that is keyed, not written out ------------------ */
    'sgroup.room': 'Αίθουσα',
    'sgroup.film': 'Ταινία',
    'sgroup.bass': 'Μπάσα',
    'sgroup.audience': 'Κοινό',
    'field.master': 'Γενική ένταση',
    'field.movie': 'Ταινία',
    'field.embedRoom': 'Πόσο μετράει η θέση σου',
    'field.xcurve': 'Ψηλά ταινίας (X-curve)',
    'field.bass': 'Μπάσα (LFE)',
    'field.bassExtension': 'Έκταση μπάσου',
    'field.bassCrossover': 'Σημείο μπάσου',
    'field.occupancy': 'Πληρότητα αίθουσας',
    'field.crowd': 'Ένταση κοινού',
    'field.crowdSpread': 'Άνοιγμα κοινού',
    'field.foley': 'Βήματα και καθίσματα',
    'field.room': 'Αέρας και κλιματισμός',
    'field.reverb': 'Ηχώ αίθουσας',
    'field.reverbTail': 'Διάρκεια ηχώς',
    'unit.seconds': 'δευτ.',
    'sound.cinema': 'Σινεμά',
    'sound.imax': 'IMAX',
    'sound.quiet': 'Ήσυχη αίθουσα',
    'sound.premiere': 'Πρεμιέρα',
    'sound.home': 'Σαλόνι',
    'picture.normal': 'Κανονικό',
    'picture.brighter': 'Πιο φωτεινό',
    'picture.warm': 'Ζεστό',
    'picture.cool': 'Ψυχρό',
    'value.monochrome': 'Ασπρόμαυρο',

    /* --- what the room says when something will not play ------------------ */
    'err.aborted': 'Η φόρτωση του βίντεο σταμάτησε.',
    'err.network': 'Χάθηκε η σύνδεση ενώ κατέβαινε το βίντεο.',
    'err.decode': 'Το αρχείο φαίνεται χαλασμένο και δεν διαβάζεται.',
    'err.format': 'Ο browser δεν παίζει αυτή τη μορφή βίντεο. Δοκίμασε MP4 (H.264) ή WebM.',
    'err.unknown': 'Δεν μπόρεσα να παίξω αυτό το αρχείο ή link.',
    'err.noSource': 'Δώσε ένα αρχείο ταινίας ή ένα link.',
    'err.tapToStart': 'Ο browser περιμένει ένα κλικ σου για να ξεκινήσει η ταινία.',
    'err.tapToStartLive': 'Ο browser περιμένει ένα κλικ σου για να ξεκινήσει η ζωντανή προβολή.',
    'err.hls': 'Αυτό το live stream (m3u8) θέλει τη βιβλιοθήκη hls.js για να παίξει εδώ.',
    'err.crossOriginAudio':
      'Το link δεν επιτρέπει ανάγνωση ήχου από άλλο site, οπότε ο ήχος παίζει κανονικά αλλά χωρίς χωρικό εφέ.',
    'err.noSpatial': 'Ο ήχος παίζει κανονικά, αλλά χωρίς χωρικό εφέ σε αυτό το αρχείο.',
    'err.reverb': 'Δεν φορτώθηκε το αρχείο reverb.',
    'err.embedBlocked': 'Αυτό το βίντεο του YouTube δεν επιτρέπει προβολή έξω από το YouTube.',
    'err.embedNoPlayer': 'Δεν φόρτωσε ο player του YouTube. Δες τη σύνδεση ή τυχόν ad blocker.',
    'err.fullscreen': 'Ο browser δεν επιτρέπει πλήρη οθόνη αυτή τη στιγμή.',
    'err.embedSound': 'Παίζει από τον player του YouTube: η ένταση τον πιάνει, η ηχώ της αίθουσας όχι.',
    'view.first-person': 'Πρώτο πρόσωπο',
    'view.back-row': 'Τελευταία σειρά',
    'view.booth': 'Θάλαμος προβολής',
    'view.side': 'Πλάγια θέα',
    'view.stage': 'Μπροστά από την οθόνη',
    'view.wide': 'Πανοραμική',
    'view.sofa': 'Από τον καναπέ',
    'view.door': 'Από την πόρτα',
    'view.corridor': 'Από τον διάδρομο',
    'view.behind-tv': 'Πίσω από την τηλεόραση',
    'view.fire': 'Δίπλα στο τζάκι',
    'view.window': 'Από το παράθυρο',
    'value.warm': 'Ζεστό',
    'value.warmPlus': 'Ζεστό+',
    'value.neutral': 'Ουδέτερο',
    'value.cool': 'Ψυχρό',
    'value.off': 'Κλειστά',
    'value.lighter': 'Ανοιχτοί',
    'value.darker': 'Κλειστοί',
    'value.people': 'άτομα',
    'queue.auto': 'Αυτόματα μετά το κενό',
    'queue.next': 'Επόμενη ταινία',

    /* --- slider labels, by field key ------------------------------------ */
    'field.house': 'Φώτα αίθουσας',
    'field.screenGain': 'Λάμψη οθόνης',
    'field.warmth': 'Ζεστό ή ψυχρό',
    'field.aisle': 'Φωτάκια διαδρόμου',
    'field.exit': 'Πινακίδες εξόδου',
    'field.exposure': 'Φωτεινότητα εικόνας',
    'field.curtains': 'Κουρτίνες',
    'field.audience': 'Θεατές στις θέσεις',
    'field.gap': 'Κενό ανάμεσα στις ταινίες',
    'field.embedQuality': 'Ποιότητα YouTube',
    'field.brightness': 'Φωτεινότητα',
    'field.contrast': 'Αντίθεση',
    'field.saturation': 'Ζωντάνια χρωμάτων',
    'field.gamma': 'Μεσαίοι τόνοι',
    'field.enabled': 'Λάμψη οθόνης',
    'field.strength': 'Ένταση',
    'field.radius': 'Άπλωμα',
    'field.threshold': 'Όριο φωτεινότητας',
    'field.horror': 'Ένταση τρόμου',
    'field.fire': 'Φωτιά στο τζάκι',
    'field.ambience': 'Ήχοι δωματίου',
    'field.tvHorror': 'Τηλεόραση · σπίτι τρόμου',
    'field.tvCozy': 'Τηλεόραση · ζεστό σαλόνι',

    /* --- chips ---------------------------------------------------------- */
    'preset.showtime': 'Προβολή',
    'preset.half': 'Ημίφως',
    'preset.interval': 'Διάλειμμα',
    'venue.cinema': 'Σινεμά',
    'venue.horror': 'Σπίτι τρόμου',
    'venue.cozy': 'Ζεστό σαλόνι',
    'ratio.scope': 'Πανοραμική',
    'ratio.flat': 'Σινεμά',
    'ratio.hd': 'Τηλεόραση',

    'hint.keys': 'L κρύβει τη μπάρα · 🎬 καθαρή οθόνη · [ ] φώτα · V θέα · C κάδρο · δεξί κλικ μενού',
  },

  en: {
    'dock.venue': 'Place',
    'dock.screen': 'Screen',
    'dock.lights': 'Lights',
    'dock.sound': 'Sound',
    'dock.view': 'View',
    'dock.queue': 'Queue',
    'dock.play': 'Play',
    'dock.pause': 'Pause',
    'dock.time': 'Position in the film',
    'dock.seek': 'Seek',
    'dock.badTime': 'Write a time like 1:21:04',
    'dock.volume': 'Volume',
    'net.inRoom': 'in the room',
    'net.mic': 'Microphone',
    'net.micDenied': 'No permission',
    'net.micMuted': 'Muted',
    'net.micOn': 'Live',
    'dock.quality': 'Quality',
    'dock.clean': 'Clean screen · the film only',
    'dock.library': 'Library',
    'library.loading': 'Loading the programme...',
    'library.empty': 'No programme yet.',
    'library.untitled': 'Untitled',
    'library.hint': 'Pick a film below, then press Start - it plays for the WHOLE hall.',
    'library.tonight': 'Tonight in the hall',
    'library.startForAll': 'Start it for the whole hall',
    'library.minutes': 'min',
    'library.secondsShort': 's',
    'library.byWhom': 'by',
    'library.byViews': 'Most watched',
    'library.byLikes': 'Most liked',
    'library.byLength': 'Feature length',
    'library.films': 'films',
    'library.paused': 'Interval · lights up',
    'library.resumed': 'Back on',
    'library.hold': 'Interval',
    'library.resume': 'Resume',
    'dock.share': 'Share your screen with the hall',
    'dock.shareStop': 'Stop sharing',
    'flash.shareOn': 'The hall is watching your screen',
    'flash.shareOff': 'Sharing stopped',
    'flash.shareCancelled': 'Cancelled',
    'flash.shareNoVideo': 'The share came back without a picture',
    'group.saveLights': 'Save the current lights as',
    'toggle.effects': 'Room sound effects',
    'group.subtitles': 'Subtitles',
    'toggle.captions': 'YouTube subtitles',
    'group.embedRoom': 'A film from YouTube',
    'hint.embedRoom':
      'A YouTube film plays in its own player, so the hall reverb and the sub cannot reach it. Where you are standing can: walk away or turn your back and it gets quieter, the way it does in a real auditorium.',
    'flash.captionsOn': 'Subtitles: on',
    'flash.captionsOff': 'Subtitles: off',
    'flash.cleanOn': 'Clean screen · press L or Esc to come back',
    'menu.cleanOn': 'Clean screen',
    'menu.cleanOff': 'Bring the controls back',
    'flash.savedLights': 'Saved',
    'flash.effectsOn': 'Room sound effects: on',
    'flash.effectsOff': 'Room sound effects: off',

    'group.audience': 'Audience',
    'group.picture': 'Picture',
    'group.bloom': 'Glow',
    'group.show': 'Screening',
    'group.version': 'Version',
    'group.language': 'Language',
    'group.next': 'Coming up',
    'group.curtains': 'Curtains',
    'group.quality': 'YouTube quality',
    'curtain.open': 'Open',
    'curtain.closed': 'Closed',
    'quality.auto': 'Auto',
    'btn.reset': 'Reset',
    'btn.resetAll': 'Reset all',
    'tip.reset': 'Back to the original value',

    'btn.testSounds': 'Test the sounds',
    'btn.startNow': 'Start now',
    'btn.whatsNew': 'What changed',
    'btn.clearQueue': 'Clear the queue',
    'btn.remove': 'Remove',
    'btn.later': 'Later',
    'btn.update': 'Update',
    'btn.close': 'Close',

    'toggle.cinematic': 'Cinematic frame (C)',
    'toggle.ceremony': 'Ceremony: lights and curtains',
    'toggle.yes': 'Yes',
    'toggle.no': 'No',

    'menu.play': 'Play',
    'menu.pause': 'Pause',
    'menu.noFilm': 'no film',
    'menu.openFilm': 'Open a film...',
    'menu.next': 'Next in the list',
    'menu.previous': 'Previous',
    'menu.of': 'of',
    'menu.fullscreen': 'Full screen',
    'menu.screenSize': 'Screen format',
    'menu.lights': 'Lights',
    'menu.view': 'View',
    'menu.venue': 'Place',
    'menu.leaveFrame': 'Leave the frame',
    'menu.enterFrame': 'Cinematic frame',
    'menu.stand': 'Stand up',
    'menu.sit': 'Sit here',
    'menu.dock': 'Control bar',
    'menu.enterRoom': 'Enter the room',
    'menu.click': 'click',
    'menu.updateNow': 'Update to the new version',
    'menu.whatsNew': 'What changed',

    'flash.houseLights': 'House lights',
    'flash.soundTest': 'Footsteps, seat, switch',
    'flash.enjoy': 'Enjoy the film',
    'flash.interval': 'Interval',
    'flash.filmOver': 'End of the screening',
    'flash.upNext': 'Up next',
    'flash.queued': 'Added to the queue',
    'flash.crosshairOn': 'Centre sight: on',
    'flash.crosshairOff': 'Centre sight: off',

    'hud.keys':
      'W A S D move · Space jump · E sit · V views · C cinema · wheel zoom · Caps sight · L bar · Esc',
    'hud.enter': 'Click to enter the room',
    'hud.cinematic': 'Cinema · click or any key to leave',
    'hud.firstPerson': 'First person',
    'hud.nextView': 'V for the next one',
    'hud.satDown': 'You sat down',
    'hud.stoodUp': 'You stood up',
    'hud.seat': 'seat',
    'hud.noSeat': 'No free seat within reach',
    'hud.seatTaken': 'That seat is taken',

    'start.kicker': 'Virtual cinema',
    'start.title': 'The room is ready',
    'start.sub': 'Walk in, and put a film on whenever you feel like it.',
    'start.cta': 'Enter the room',
    'start.pick': 'Or choose a film now',
    'start.note': 'One click is needed, so the browser will allow sound.',
    'start.pickFile': 'Choose a video file from your computer.',

    /* --- the foyer: a name and a hall ------------------------------------ */
    'lobby.sub': 'Pick a hall. Whatever is on in there, you all watch together.',
    'lobby.yourName': 'Your name',
    'lobby.namePlaceholder': 'e.g. ALEX',
    'lobby.hall': 'Hall',
    'lobby.enterHall': 'Go in',
    'lobby.empty': 'empty',
    'lobby.full': 'full',
    'lobby.person': 'person',
    'lobby.people': 'people',
    'lobby.nothingOn': 'Nothing on',
    'lobby.aFilm': 'A film is on',
    'lobby.justStarted': 'just started',
    'lobby.minutesIn': 'minutes in',
    'lobby.note': 'The name lasts as long as your visit. You join the film where it already is.',
    'lobby.joinedAt': 'You came in at',
    'lobby.localOnly':
      '<b>Only you can see this film.</b> It is a file on your own computer, and nobody else in the hall can open it. To watch it together, put it on with <b>"From a link"</b> (YouTube or Vimeo).',

    'picker.open': 'A file from your computer (you only)',
    'picker.link': 'From a link',
    'picker.play': 'Play',
    'picker.queue': 'Queue it',
    'picker.url': 'YouTube or Vimeo link, or a file (mp4, webm)',
    'picker.hint': 'Paste a YouTube or Vimeo link and the WHOLE hall sees it, from the same moment.',
    'picker.needUrl': 'Put a video address in first.',
    'picker.notVideo': 'That is not a video file. Try MP4 or WebM.',
    'picker.loading': 'Loading',
    'picker.drop': 'Drop the video here',
    'picker.dropNote': 'It plays on the big screen straight away',

    'update.title': 'A new version is ready',
    'update.detail': 'Update whenever it suits you.',
    'update.dev': 'Something changed in the code. Update whenever you like.',
    'update.version': 'Version',
    'update.changelog': 'What changed',
    'update.running': 'You are running version',
    'update.loading': 'Loading...',
    'update.missing': 'The list of changes was not found.',

    'queue.empty': 'The queue is empty. Add films from "Open a film".',
    'queue.now': 'Playing now',
    'queue.waiting': 'Next in',
    'queue.seconds': 's',
    'queue.playNow': 'Play this now',
    'queue.skip': 'Skip to the next one',

    /* --- everything else that is keyed, not written out ------------------ */
    'sgroup.room': 'The room',
    'sgroup.film': 'The film',
    'sgroup.bass': 'Bass',
    'sgroup.audience': 'Audience',
    'field.master': 'Overall volume',
    'field.movie': 'Film',
    'field.embedRoom': 'How much your seat matters',
    'field.xcurve': 'Film treble (X-curve)',
    'field.bass': 'Bass (LFE)',
    'field.bassExtension': 'Bass reach',
    'field.bassCrossover': 'Bass crossover',
    'field.occupancy': 'How full the room is',
    'field.crowd': 'Audience level',
    'field.crowdSpread': 'Audience spread',
    'field.foley': 'Footsteps and seats',
    'field.room': 'Air and ventilation',
    'field.reverb': 'Room reverb',
    'field.reverbTail': 'How long it rings',
    'unit.seconds': 's',
    'sound.cinema': 'Cinema',
    'sound.imax': 'IMAX',
    'sound.quiet': 'Quiet room',
    'sound.premiere': 'Premiere',
    'sound.home': 'Living room',
    'picture.normal': 'Normal',
    'picture.brighter': 'Brighter',
    'picture.warm': 'Warm',
    'picture.cool': 'Cool',
    'value.monochrome': 'Black and white',

    /* --- what the room says when something will not play ------------------ */
    'err.aborted': 'Loading the video stopped.',
    'err.network': 'The connection was lost while the video was coming down.',
    'err.decode': 'The file looks damaged and cannot be read.',
    'err.format': 'The browser does not play this video format. Try MP4 (H.264) or WebM.',
    'err.unknown': 'That file or link would not play.',
    'err.noSource': 'Give it a film file or a link.',
    'err.tapToStart': 'The browser is waiting for a click of yours before the film starts.',
    'err.tapToStartLive': 'The browser is waiting for a click of yours before the live stream starts.',
    'err.hls': 'This live stream (m3u8) wants the hls.js library to play in here.',
    'err.crossOriginAudio':
      'The link does not allow another site to read its sound, so it plays normally but without the spatial effect.',
    'err.noSpatial': 'The sound plays normally, but without the spatial effect on this file.',
    'err.reverb': 'The reverb file did not load.',
    'err.embedBlocked': 'This YouTube video does not allow playback outside YouTube.',
    'err.embedNoPlayer': 'The YouTube player did not load. Check the connection, or an ad blocker.',
    'err.fullscreen': 'The browser will not allow full screen right now.',
    'err.embedSound': 'Playing from the YouTube player: the volume reaches it, the hall reverb does not.',
    'view.first-person': 'First person',
    'view.back-row': 'Back row',
    'view.booth': 'Projection booth',
    'view.side': 'From the side',
    'view.stage': 'In front of the screen',
    'view.wide': 'Wide',
    'view.sofa': 'From the sofa',
    'view.door': 'From the door',
    'view.corridor': 'Down the corridor',
    'view.behind-tv': 'Behind the television',
    'view.fire': 'By the fire',
    'view.window': 'From the window',
    'value.warm': 'Warm',
    'value.warmPlus': 'Warm+',
    'value.neutral': 'Neutral',
    'value.cool': 'Cool',
    'value.off': 'Off',
    'value.lighter': 'Lifted',
    'value.darker': 'Deeper',
    'value.people': 'people',
    'queue.auto': 'Start on its own after the gap',
    'queue.next': 'Next film',

    'field.house': 'House lights',
    'field.screenGain': 'Light off the screen',
    'field.warmth': 'Warm or cool',
    'field.aisle': 'Aisle lights',
    'field.exit': 'Exit signs',
    'field.exposure': 'Overall brightness',
    'field.curtains': 'Curtains',
    'field.audience': 'People in the seats',
    'field.gap': 'Gap between films',
    'field.embedQuality': 'YouTube quality',
    'field.brightness': 'Brightness',
    'field.contrast': 'Contrast',
    'field.saturation': 'Colour',
    'field.gamma': 'Midtones',
    'field.enabled': 'Glow',
    'field.strength': 'Strength',
    'field.radius': 'Spread',
    'field.threshold': 'Brightness threshold',
    'field.horror': 'How frightening',
    'field.fire': 'The fire',
    'field.ambience': 'Room sounds',
    'field.tvHorror': 'Television · horror house',
    'field.tvCozy': 'Television · cosy room',

    'preset.showtime': 'Showtime',
    'preset.half': 'Half lights',
    'preset.interval': 'Interval',
    'venue.cinema': 'Cinema',
    'venue.horror': 'Horror house',
    'venue.cozy': 'Cosy room',
    'ratio.scope': 'Scope',
    'ratio.flat': 'Flat',
    'ratio.hd': 'Widescreen',

    'hint.keys': 'L hides the bar · 🎬 clean screen · [ ] lights · V view · C frame · right click for the menu',
  },
}

/** Labels that live inside other modules and are keyed by id, not by sentence. */
const KEYED = ['field', 'preset', 'venue', 'ratio', 'view']

function readStored() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved && STRINGS[saved]) return saved
  } catch {
    /* private mode, never mind */
  }
  // Nothing chosen yet: follow the browser, and fall back to Greek.
  const browser = (navigator.language || '').slice(0, 2).toLowerCase()
  return STRINGS[browser] ? browser : 'el'
}

let language = readStored()
const listeners = new Set()

/** The current language code, 'el' or 'en'. */
export function getLanguage() {
  return language
}

export function setLanguage(code) {
  const next = STRINGS[code] ? code : language
  if (next === language) return language
  language = next
  try {
    localStorage.setItem(STORAGE_KEY, language)
  } catch {
    /* private mode, never mind */
  }
  document.documentElement.lang = language
  for (const fn of [...listeners]) {
    try {
      fn(language)
    } catch (err) {
      console.error('[i18n] listener failed', err)
    }
  }
  return language
}

export function toggleLanguage() {
  return setLanguage(language === 'el' ? 'en' : 'el')
}

/** @returns {() => void} unsubscribe */
export function onLanguageChange(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/**
 * One string. Missing keys come back as the key, which is ugly on purpose.
 * @param {string} key
 * @param {Record<string, string|number>} [vars] `{name}` placeholders
 */
export function t(key, vars) {
  const table = STRINGS[language] ?? STRINGS.el
  let value = table[key] ?? STRINGS.el[key] ?? key
  if (vars) {
    for (const [name, replacement] of Object.entries(vars)) {
      value = value.replaceAll(`{${name}}`, String(replacement))
    }
  }
  return value
}

/** True when we have a translation, so a caller can keep its own default. */
export function has(key) {
  return Boolean(STRINGS[language]?.[key] ?? STRINGS.el[key])
}

/**
 * Swap the label of a `{ key, label }` record for the translated one.
 *
 * This is the whole of "the mixer and the venues speak two languages": their
 * field tables keep their own Greek labels as the fallback, and the panel runs
 * every row through here on the way to the screen.
 *
 * @param {object} field
 * @param {string} [kind] which keyed table to look in, default 'field'
 */
export function translateField(field, kind = 'field') {
  if (!field?.key) return field
  const id = `${kind}.${field.key}`
  return has(id) ? { ...field, label: t(id) } : field
}

/** Same idea for a chip: `{ key, label }` in, translated label out. */
export function translateChip(chip, kind) {
  if (!chip?.key) return chip
  const id = `${kind}.${chip.key}`
  return has(id) ? { ...chip, label: t(id) } : chip
}

export { KEYED }
export default t
