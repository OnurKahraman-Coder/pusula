"""1. Lig takım adı -> sistemin tek adı (Süper Lig'deki football-data yazımıyla aynı ki takım tek kalsın).
Aynı tablo tools/tr1lig.js içinde de var (T2_CANON); ikisini birlikte güncelle."""
FOLD = str.maketrans('ıİşŞğĞüÜöÖçÇâÂ', 'iIsSgGuUoOcCaA')
SPECIAL = {
    'F. Karagümrük': 'Karagumruk', 'Ç. Rizespor': 'Rizespor', 'Çorum FK': 'Corum',
    'Erzurumspor FK': 'Erzurum BB', 'Amed SK': 'Amedspor', 'Ankaraspor': 'Ankaraspor AS',
    'Beykoz A.Ş.': 'Beykoz', 'Göztepe': 'Goztepe',
}


def canon(n):
    n = n.strip()
    return SPECIAL.get(n) or n.translate(FOLD)
