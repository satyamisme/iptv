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
