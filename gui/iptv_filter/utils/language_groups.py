LANGUAGE_GROUPS = {
    "Indian Languages": ["hin", "tel", "tam", "mal", "kan", "mar", "ben", "urd", "pan", "guj", "ori", "asm", "nep", "sin"],
    "European Languages": ["eng", "fra", "spa", "deu", "ita", "por", "rus"],
    "Asian Languages": ["chi", "jpn", "kor", "ara", "per", "tur"],
    "African Languages": ["swa", "amh", "hau", "yor", "zul"]
}

def get_language_group(code: str) -> str:
    for group, codes in LANGUAGE_GROUPS.items():
        if code in codes:
            return group
    return "Other Languages"
