> ## AI Agent Context
> - Full documentation index: https://aistudio.google.com/llms.txt
> - Gemini Docs MCP server (consistent live info): https://gemini-api-docs-mcp.dev
> - Coding agent skills & setup guide: https://aistudio.google.com/docs/coding-agents.md

# Gemini 4 Argon

Gemini 4 Argon (`gemini-4-argon`) is our efficient Gemini 4 frontier reasoning model. It delivers Gemini 4 intelligence with faster responses and lower token spend per turn compared to [Gemini 4 Carbon](/docs/models/gemini-4-carbon) across complex coding, agentic, math, and science tasks. Like Carbon, it supports a unified 1M-token context window and [long decode](/docs/long-decode) up to 1M tokens.

{% button href="https://aistudio.google.com/prompts/new_chat?model=gemini-4-argon" variant="ais" %}Try in Google AI Studio{% /button %}

## Documentation  {% id="documentation" %}

Visit the [What's new in Gemini 4 Argon](/docs/whats-new-gemini-4-argon) page
for full coverage of features and API changes, or read [Choosing a model](/docs/choosing-a-model) to compare our latest Gemini models.

## gemini-4-argon  {% id="gemini-4-argon" %}

{% table variant="model" %}
  * Property
  * Description

  ---

  *     {% section class="model-property" %}
  {% icon name="id_card" /%}Model code

    {% /section %}

  * `gemini-4-argon`

  ---

  *     {% section class="model-property" %}
  {% icon name="save" /%}Supported data types

    {% /section %}

  *     **Inputs** Text, Image, Video, Audio, and PDF

    **Output** Text


  ---

  *     {% section class="model-property" %}
  {% icon name="token_auto" /%}Token limits{% sup %}[[*]](/docs/tokens){% /sup %}

    {% /section %}

  *     **Context window (unified input and output token limit)** 1,048,576

    **Max output** 65,536 (default synchronous) / up to 1,048,576 (with [long decode](/docs/long-decode))


  ---

  *     {% section class="model-property" %}
  {% icon name="handyman" /%}Capabilities

    {% /section %}

  *     {% section class="three-column-grid" %}
  {% section %}
  [**Agentic video understanding**](/docs/video-understanding#agentic-video-understanding)

  {% badge label=Supported (defaults to static) type="supported" /%}

  {% /section %}

  {% section %}
  [**Audio generation**](/docs/speech-generation)

  {% badge type="not-supported" /%}

  {% /section %}

  {% section %}
  [**Code execution**](/docs/code-execution)

  {% badge type="supported" /%}

  {% /section %}

  {% section %}
  [**Computer use**](/docs/computer-use)

  {% badge type="supported" /%}

  {% /section %}

  {% section %}
  [**Context caching**](/docs/caching)

  {% badge label=Supported (Implicit only) type="supported" /%}

  Note: Explicit caching is not supported.

  {% /section %}

  {% section %}
  [**File search**](/docs/file-search)

  {% badge type="supported" /%}

  {% /section %}

  {% section %}
  [**Function calling**](/docs/function-calling)

  {% badge type="supported" /%}

  {% /section %}

  {% section %}
  [**Grounding with Google Maps**](/docs/maps-grounding)

  {% badge type="supported" /%}

  {% /section %}

  {% section %}
  [**Grounding with Google Search**](/docs/google-search)

  {% badge type="supported" /%}

  {% /section %}

  {% section %}
  [**Image generation**](/docs/image-generation)

  {% badge type="not-supported" /%}

  {% /section %}

  {% section %}
  [**Live API**](/docs/live-api)

  {% badge type="not-supported" /%}

  {% /section %}

  {% section %}
  [**Structured outputs**](/docs/structured-output)

  {% badge type="supported" /%}

  {% /section %}

  {% section %}
  [**Thinking**](/docs/thinking)

  {% badge label=Supported (low, medium, high) type="supported" /%}

  {% /section %}

  {% section %}
  [**Tool retrieval**](/docs/tool-retrieval)

  {% badge label=Supported (Preview) type="supported" /%}

  {% /section %}

  {% section %}
  [**URL context**](/docs/url-context)

  {% badge type="supported" /%}

  {% /section %}

    {% /section %}


  ---

  *     {% section class="model-property" %}
  {% icon name="speed" /%}Consumption options

    {% /section %}

  *     {% section class="three-column-grid" %}
  {% section %}
  [**Batch API**](/docs/batch-api)

  {% badge type="supported" /%}

  {% /section %}

  {% section %}
  [**Flex inference**](/docs/flex-inference)

  {% badge type="supported" /%}

  {% /section %}

  {% section %}
  [**Priority inference**](/docs/priority-inference)

  {% badge type="supported" /%}

  {% /section %}

    {% /section %}


  ---

  *     {% section class="model-property" %}
  {% icon name="123" /%}Versions

    {% /section %}

  *     Read the [model version patterns](/docs/models#model-versions) for more details.

    *   Stable: `gemini-4-argon`


  ---

  *     {% section class="model-property" %}
  {% icon name="calendar_month" /%}Latest update

    {% /section %}

  * October 2026

  ---

  *     {% section class="model-property" %}
  {% icon name="id_card" /%}Model card

    {% /section %}

  * [Model card](https://deepmind.google/models/model-cards/gemini-4-argon/)

  ---

  *     {% section class="model-property" %}
  {% icon name="paid" /%}Pricing

    {% /section %}

  * [Pricing](/docs/pricing#gemini-4-argon)
{% /table %}

