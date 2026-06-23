from dataclasses import dataclass, field
from typing import List, Optional

@dataclass
class Channel:
    id: str
    name: str
    alt_names: List[str] = field(default_factory=list)
    network: Optional[str] = None
    owners: List[str] = field(default_factory=list)
    country: str = ""
    categories: List[str] = field(default_factory=list)
    is_nsfw: bool = False
    launched: Optional[str] = None
    closed: Optional[str] = None
    replaced_by: Optional[str] = None
    website: Optional[str] = None

    # Internal fields for combined display and easier filtering
    streams: List[dict] = field(default_factory=list)
    languages: List[str] = field(default_factory=list)

    # Status fields
    status_icon: str = "❓"
    status_text: str = "Unknown"

    def __post_init__(self):
        if self.alt_names is None:
            self.alt_names = []
        if self.owners is None:
            self.owners = []
        if self.categories is None:
            self.categories = []
        elif isinstance(self.categories, str):
            self.categories = [c.strip() for c in self.categories.split(",") if c.strip()]
            
        if self.streams is None:
            self.streams = []
        if self.languages is None:
            self.languages = []
        elif isinstance(self.languages, str):
            self.languages = [l.strip() for l in self.languages.split(",") if l.strip()]
            
        # Ensure they are lists
        if not isinstance(self.categories, list):
            self.categories = list(self.categories) if self.categories else []
        if not isinstance(self.languages, list):
            self.languages = list(self.languages) if self.languages else []
        if not isinstance(self.alt_names, list):
            self.alt_names = list(self.alt_names) if self.alt_names else []

        # Clean/sanitize strings
        self.categories = [str(c).strip() for c in self.categories if c and str(c).strip()]
        self.languages = [str(l).strip() for l in self.languages if l and str(l).strip()]
        self.alt_names = [str(a).strip() for a in self.alt_names if a and str(a).strip()]
        
        if self.country is None:
            self.country = ""
        else:
            self.country = str(self.country).strip()
            
        if self.name is None:
            self.name = ""
        else:
            self.name = str(self.name).strip()

