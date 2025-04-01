# `@ubiquity-os/daemon-pull-review`

This is a high context aware GitHub organization integrated bot that uses a LLM to provide automated reviews and feedback to Github pull requests.

## Usage

Just convert a pull request to be ready for review and the bot automatically reviews and requests changes if necessary

## How it works

With its huge context window, we are able to feed the entire issue specification and the pull request to the model which we obtain. This allows the model to have a very deep understanding of the current scope and provide highly relevant reviews.

## Technical Architecture

### Core System Design

- **Cloudflare Worker-based Service**: Implements a serverless architecture running on Cloudflare's edge network
- **GitHub App Integration**: Processes webhooks and interacts with GitHub's API for pull request management
- **OpenRouter Integration**: Provides access to LLMs through OpenRouter's API
- **TypeScript Implementation**: Ensures type safety and better code maintainability

### Key Components

1. **Pull Request Processing Pipeline**

   - Webhook event handling for pull request activities
   - Diff parsing and analysis system
   - Context gathering from repository files
   - Ground truth-based prompt generation
   - Review generation and posting

2. **Context Management**

   - Efficient handling of large context windows (up to 200k tokens)
   - Smart chunking of pull request content
   - Issue specification integration
   - Repository configuration parsing

3. **LLM Integration Layer**

   - Configurable model selection through OpenRouter
   - Token limit management
   - Response streaming capabilities
   - Error handling and retry logic

4. **Configuration System**
   - YAML-based configuration through `.ubiquity-os.config.yml`
   - Environment variable management
   - Model-specific token limit configuration
   - Flexible plugin architecture

## Installation

`.ubiquity-os.config.yml`:

```yml
plugins:
  - uses:
      - plugin: ubiquity-os-marketplace/daemon-pull-review
        with:
          openRouterAiModel: "" # Optional - defaults to "anthropic/claude-3.5-sonnet"
          openRouterBaseUrl: "" # Optional - defaults to Open Router's API endpoint
          maxRetryAttempts: 5 # Optional - defaults to 5
          reviewInterval: "1 Hour" # Optional - defaults to no interval (review on every `ready_for_review` event)
```

`.dev.vars` (for local testing):

specify the OpenRouterBase URL in the `.ubiquity-os.config.yml` file and set the `OPENROUTER_API_KEY` in the `.dev.vars` file.

```sh
OPENROUTER_API_KEY=YOUR_OPENROUTER_API_KEY
UBIQUITY_OS_APP_NAME="UbiquityOS"
```

## Testing

```sh
bun run test
```

The test suite includes:

- Unit tests for core functionality
- Integration tests for GitHub webhook processing
- Mock handlers for API interactions
- Template-based test fixtures for consistent testing
