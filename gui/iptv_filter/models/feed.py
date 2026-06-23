from dataclasses import dataclass, field
from typing import List

@dataclass
class Feed:
    channel: str
    id: str
    name: str
    alt_names: List[str] = field(default_factory=list)
    is_main: bool = False
    broadcast_area: List[str] = field(default_factory=list)
    timezones: List[str] = field(default_factory=list)
    languages: List[str] = field(default_factory=list)
    format: str = ""
