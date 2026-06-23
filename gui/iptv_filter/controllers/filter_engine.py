from typing import List, Dict, Set
from iptv_filter.models.channel import Channel

class FilterEngine:
    def __init__(self):
        self.channels: List[Channel] = []
        self.filtered_channels: List[Channel] = []

        # Lookups
        self.channels_by_language: Dict[str, Set[str]] = {}
        self.channels_by_category: Dict[str, Set[str]] = {}
        self.channels_by_country: Dict[str, Set[str]] = {}
        self.channels_by_id: Dict[str, Channel] = {}

    def load_channels(self, channels: List[Channel]):
        self.channels = channels
        self._build_lookups()
        self.filtered_channels = self.channels.copy()

    def _build_lookups(self):
        self.channels_by_language.clear()
        self.channels_by_category.clear()
        self.channels_by_country.clear()
        self.channels_by_id.clear()

        for ch in self.channels:
            if ch.id:
                self.channels_by_id[ch.id] = ch
            if ch.country:
                self.channels_by_country.setdefault(ch.country, set()).add(ch.id)
            for cat in ch.categories:
                self.channels_by_category.setdefault(cat, set()).add(ch.id)
            for lang in ch.languages:
                self.channels_by_language.setdefault(lang, set()).add(ch.id)

    def get_country_counts(self) -> Dict[str, int]:
        return {country: len(ids) for country, ids in self.channels_by_country.items()}

    def get_statistics(self) -> dict:
        total = len(self.channels)
        filtered = len(self.filtered_channels)

        lang_counts = [(l, len(ids)) for l, ids in self.channels_by_language.items()]
        lang_counts.sort(key=lambda x: x[1], reverse=True)
        top_langs = lang_counts[:5]

        cat_counts = [(c, len(ids)) for c, ids in self.channels_by_category.items()]
        cat_counts.sort(key=lambda x: x[1], reverse=True)
        top_cats = cat_counts[:5]

        seen_urls = set()
        duplicate_count = 0
        working_count = 0
        dead_count = 0
        geo_count = 0

        for ch in self.filtered_channels:
            if ch.status_text == "Working" or ch.status_text == "Slow":
                working_count += 1
            elif ch.status_text == "Dead":
                dead_count += 1
            elif ch.status_text == "Geo-blocked":
                geo_count += 1

            if ch.streams:
                url = ch.streams[0].get("url")
                if url in seen_urls:
                    duplicate_count += 1
                else:
                    seen_urls.add(url)

        return {
            "total": total,
            "filtered": filtered,
            "top_languages": top_langs,
            "top_categories": top_cats,
            "duplicates_in_filtered": duplicate_count,
            "working_count": working_count,
            "dead_count": dead_count,
            "geo_count": geo_count
        }

    def remove_duplicates(self) -> int:
        seen_urls = set()
        unique_channels = []
        removed_count = 0
        for ch in self.filtered_channels:
            if ch.streams:
                url = ch.streams[0].get("url")
                if url in seen_urls:
                    removed_count += 1
                    continue
                seen_urls.add(url)
            unique_channels.append(ch)

        self.filtered_channels = unique_channels
        return removed_count

    def remove_dead_streams(self) -> int:
        alive_channels = []
        removed_count = 0
        for ch in self.filtered_channels:
            if ch.status_text == "Dead":
                removed_count += 1
                continue
            alive_channels.append(ch)

        self.filtered_channels = alive_channels
        return removed_count

    def remove_geoblocked_streams(self) -> int:
        alive_channels = []
        removed_count = 0
        for ch in self.filtered_channels:
            if ch.status_text == "Geo-blocked":
                removed_count += 1
                continue
            alive_channels.append(ch)

        self.filtered_channels = alive_channels
        return removed_count

    def apply_filters(self,
                      search_term: str = "",
                      languages: List[str] = None,
                      categories: List[str] = None,
                      countries: List[str] = None,
                      nsfw: bool = False,
                      exclude_closed: bool = True,
                      favorites_only: bool = False,
                      working_only: bool = False,
                      favorites_set: Set[str] = None,
                      statuses: List[str] = None,
                      stream_format: str = None,
                      selected_only: bool = False,
                      selected_ids: List[str] = None,
                      exclude_dead: bool = False,
                      exclude_no_url: bool = False,
                      exclude_languages: bool = False,
                      exclude_categories: bool = False,
                      exclude_countries: bool = False,
                      **kwargs) -> List[Channel]:

        # Normalize/sanitize inputs for robust type safety (protects against fuzzy/toxic payloads)
        if search_term is not None:
            search_term = str(search_term)
        else:
            search_term = ""

        def sanitize_list(lst) -> List[str]:
            if not lst:
                return []
            if isinstance(lst, str):
                return [lst]
            try:
                return [str(x) for x in lst if x is not None]
            except Exception:
                return []

        languages = sanitize_list(languages)
        categories = sanitize_list(categories)
        countries = sanitize_list(countries)
        statuses = sanitize_list(statuses)
        selected_ids = sanitize_list(selected_ids)

        nsfw = bool(nsfw)
        exclude_closed = bool(exclude_closed)
        favorites_only = bool(favorites_only)
        working_only = bool(working_only)
        selected_only = bool(selected_only)
        exclude_dead = bool(exclude_dead)
        exclude_no_url = bool(exclude_no_url)
        exclude_languages = bool(exclude_languages)
        exclude_categories = bool(exclude_categories)
        exclude_countries = bool(exclude_countries)

        if stream_format is not None:
            stream_format = str(stream_format)

        favs = set()
        if favorites_set is not None:
            try:
                favs = set(favorites_set)
            except Exception:
                pass

        result_ids = {ch.id for ch in self.channels}

        if selected_only:
            result_ids.intersection_update(set(selected_ids))

        if languages:
            lang_ids = set()
            for lang in languages:
                lang_ids.update(self.channels_by_language.get(lang, set()))
            if exclude_languages:
                result_ids.difference_update(lang_ids)
            else:
                result_ids.intersection_update(lang_ids)

        if categories:
            cat_ids = set()
            for cat in categories:
                cat_ids.update(self.channels_by_category.get(cat, set()))
            if exclude_categories:
                result_ids.difference_update(cat_ids)
            else:
                result_ids.intersection_update(cat_ids)

        if countries:
            country_ids = set()
            for country in countries:
                country_ids.update(self.channels_by_country.get(country, set()))
            if exclude_countries:
                result_ids.difference_update(country_ids)
            else:
                result_ids.intersection_update(country_ids)

        filtered = []
        search_term = search_term.lower()

        # Optimize search loop by narrowing candidates down to result_ids if filters are applied
        if len(result_ids) < len(self.channels):
            candidates = [self.channels_by_id[cid] for cid in result_ids if cid in self.channels_by_id]
        else:
            candidates = self.channels

        for ch in candidates:
            if ch.id not in result_ids:
                continue

            if exclude_no_url and (not ch.streams or not any(s.get("url") for s in ch.streams)):
                continue

            if exclude_dead and ch.status_text == "Dead":
                continue

            if favorites_only and ch.id not in favs:
                continue

            if working_only and ch.status_text == "Dead":
                continue

            if statuses and ch.status_text not in statuses:
                continue

            if stream_format:
                has_hls = any(s.get("url", "").split("?")[0].endswith(".m3u8") for s in ch.streams) if ch.streams else False
                if stream_format == "hls" and not has_hls:
                    continue
                if stream_format == "non-hls" and has_hls:
                    continue

            if exclude_closed and ch.closed:
                continue

            if not nsfw and ch.is_nsfw:
                continue

            if search_term:
                name_match = search_term in ch.name.lower()
                alt_match = any(search_term in alt.lower() for alt in ch.alt_names)
                network_match = ch.network and search_term in ch.network.lower()
                if not (name_match or alt_match or network_match):
                    continue

            filtered.append(ch)

        self.filtered_channels = filtered
        return self.filtered_channels
