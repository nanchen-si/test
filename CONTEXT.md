# Weather Assistant

Weather Assistant helps a user ask questions about a place and receive answers grounded in current weather facts or a daily forecast.

## Conversation

**User**: A person asking about weather for one or more places.
_Avoid_: Visitor, customer, account

**Conversation session**: The short-lived exchange in which the assistant remembers the user's confirmed place and uses it for follow-up questions.
_Avoid_: Account, profile, permanent history

## Place and weather

**Place**: A geographically named location identified well enough to retrieve weather data, including its name, coordinates, and time zone.
_Avoid_: City string, address, location ID

**Confirmed place**: The place the user has explicitly selected or authorized the assistant to use for the current conversation session.
_Avoid_: Guessed location, default location

**Current weather**: Weather conditions observed or reported for a place at a specific time.
_Avoid_: Live weather, today's forecast

**Daily forecast**: A forecast describing expected weather conditions for a place over one calendar day in that place's local time.
_Avoid_: Weather prediction, hourly forecast

**Weather fact**: A source-backed observation or forecast value, such as temperature, condition, precipitation probability, wind, or humidity, together with its place and time.
_Avoid_: Model opinion, assistant guess

**Weather comparison**: An answer that compares weather facts for two or more confirmed or explicitly named places over the same requested period.
_Avoid_: Ranking, recommendation

**Ambiguous place**: A user-supplied place name that maps to more than one plausible place and must be clarified before weather is retrieved.
_Avoid_: Unknown place, invalid location
