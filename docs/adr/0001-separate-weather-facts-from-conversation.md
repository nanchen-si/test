# Separate weather facts from conversation generation

Status: accepted

The conversation application will obtain weather facts through a dedicated Weather MCP service, while the language model will turn those facts into a Chinese response. The Weather MCP service owns place resolution, QWeather access, response normalization, and source errors; the conversation application owns the conversation and MCP client connection. This boundary makes the MCP call observable and replaceable, keeps provider credentials out of the browser, and leaves the language model unable to invent a provider response as if it were weather data. The trade-off is an additional service boundary and one more failure point in the local POC.

## Considered options

- Let the language model call QWeather directly: rejected because it bypasses the MCP boundary and mixes provider credentials with conversation generation.
- Keep weather retrieval as an in-process helper: rejected because it would not demonstrate an independently callable MCP service.
