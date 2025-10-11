# Obsidian AI Summarize Plugin

An intelligent Obsidian plugin that leverages OpenAI's latest models to generate high-quality summaries of your notes. Featuring advanced chunking for large documents, multiple placement options, and customizable profiles for different summarization needs.

## Features

### Core Functionality

-   **AI-Powered Summarization**: Utilize OpenAI's latest models including GPT-4o, GPT-5, and reasoning models (o1, o3, o4)
-   **Smart Chunking**: Automatically handles large documents by splitting them into manageable chunks while maintaining context
-   **Real-time Streaming**: See summaries generate in real-time with token-by-token streaming
-   **Concurrency Control**: Built-in safeguards prevent overlapping requests and allow cancellation of in-progress summaries

### Flexible Placement Options

-   **Replace Selection**: Replace selected text with the generated summary
-   **Insert Below**: Add summary below the selected text
-   **Frontmatter**: Automatically add summary to note's YAML frontmatter under `summary` property

### Advanced Configuration

-   **Multiple Profiles**: Create and manage different summarization profiles with unique settings
-   **Model Selection**: Choose from GPT-3.5, GPT-4, GPT-4 Turbo, GPT-4o, GPT-5, and reasoning models
-   **Custom Prompts**: Tailor the summarization prompt to your specific needs
-   **System Instructions**: Define tone, style, language constraints, and output format
-   **Token Management**: Set custom token limits with intelligent context window budgeting
-   **Automatic Model Detection**: Plugin fetches and displays available models from your OpenAI account

Inline Summarization from menu:
![](https://github.com/RavenWits/obsidian-ai-summerize/blob/main/gifs/Inline_Summerize.gif)

Frontmatter Summarization from command palette:
![](https://github.com/RavenWits/obsidian-ai-summerize/blob/main/gifs/Frontmatter_Summarize.gif)

## Installation

### From Obsidian Community Plugins

1. Open Obsidian and navigate to **Settings** → **Community Plugins**
2. Click **Browse** and search for "AI Summarize"
3. Click **Install** and then **Enable**
4. Configure your OpenAI API key in the plugin settings

### Manual Installation

1. Download the latest release from the [GitHub releases page](https://github.com/RavenWits/obsidian-ai-summerize/releases)
2. Extract the files to your vault's `.obsidian/plugins/ai-summarize/` directory
3. Reload Obsidian
4. Enable the plugin in **Settings** → **Community Plugins**

## Usage

### Initial Setup

1. **Get an API Key**: Sign up at [OpenAI](https://platform.openai.com/signup) and generate an API key
2. **Configure Plugin**:
    - Go to **Settings** → **AI Summarize**
    - Enter your OpenAI API key
    - The plugin will automatically fetch available models
3. **Customize Settings** (Optional):
    - Choose your preferred AI model
    - Adjust max tokens (default: 1000)
    - Customize the prompt and system instructions
    - Select summary placement preference

### Generating Summaries

**Method 1: Context Menu**

1. Select text in your note (minimum 30 words)
2. Right-click to open the context menu
3. Click **"AI summarize"**
4. Watch as the summary generates in real-time

**Method 2: Command Palette**

1. Select text in your note (minimum 30 words)
2. Open command palette (`Ctrl/Cmd + P`)
3. Search for **"AI Summarize: Summarize selection"**
4. Execute the command

### Large Document Handling

When summarizing large selections that exceed the model's context window:

- The plugin automatically splits content into chunks
- Each chunk is summarized individually
- A final "meta-summary" combines all partial summaries
- Progress is displayed with part numbers (e.g., "Part 1/3")

## Configuration

### Profile Management

Create multiple profiles for different summarization scenarios:

- **Technical Notes**: Use GPT-4 with specific technical language instructions
- **Meeting Notes**: Use GPT-4o-mini for quick, bullet-point summaries
- **Research Papers**: Use reasoning models (o1, o3) for deep analysis

**Creating a Profile:**

1. Go to plugin settings
2. Click **"New profile"**
3. Configure model, tokens, prompt, and placement
4. Name your profile
5. Switch between profiles using the dropdown

### Tips for Best Results

**Prompt Engineering:**
Depending on what you summarize you can use better propmpts and save these to different profiles!
```
Good: "Summarize the following in 3-4 sentences focusing on key decisions and action items"
```
```
Better: "Create a concise summary highlighting: 1) Main decisions made, 2) Action items with owners, 3) Open questions"
```

**System Instructions:**

- Specify language: `"Always respond in Spanish"`
- Define format: `"Use bullet points with emoji indicators"`
- Set tone: `"Use professional, academic language"`
- Add constraints: `"Keep response under 100 words"`


### Key Features Implementation

**Streaming Response:**

- Uses OpenAI Responses API with streaming
- Throttled writing (50ms intervals) to reduce DOM operations
- Graceful fallback to non-streaming if streaming fails

**Chunk Processing:**

- Estimates tokens using ~4 chars per token heuristic
- Calculates available context window per model
- Splits text on paragraph boundaries
- Generates meta-summary from chunk summaries

**Concurrency Control:**

- Tracks current operation with run ID
- Uses AbortController for cancellation
- Prevents overlapping summarization requests

## Contributing

Contributions are welcome! Here's how you can help:

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes and test thoroughly
4. Commit your changes: `git commit -m 'Adds amazing feature'`
5. Push to the branch: `git push origin feature/amazing-feature`
6. Open a Pull Request

## Issues and Support

Encountered a bug or have a feature request?

1. Check [existing issues](https://github.com/RavenWits/obsidian-ai-summerize/issues)
2. If not found, [create a new issue](https://github.com/RavenWits/obsidian-ai-summerize/issues/new)
3. Provide:
    - Obsidian version
    - Plugin version
    - Model used
    - Steps to reproduce
    - Error messages (if any)

## License

This project is licensed under the [GPL-3.0 License](LICENSE).

## Support the Project

If you find this plugin valuable and want to support its continued development:

[<img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="BuyMeACoffee" width="200">](https://www.buymeacoffee.com/ravenwits)

**Other ways to support:**

-   ⭐ Star the repository
-   🐛 Report bugs and suggest features
-   📖 Improve documentation
-   💻 Contribute code
-   📢 Share with others

## Author

**Alp Sariyer**

-   Website: [alpsariyer.dev](https://www.alpsariyer.dev)
-   GitHub: [@ravenwits](https://github.com/ravenwits)

## Acknowledgments

-   Built with the [Obsidian API](https://github.com/obsidianmd/obsidian-api)
-   Powered by [OpenAI](https://openai.com/)
-   Inspired by the Obsidian community's need for intelligent note summarization

---

<div align="center">

**Happy Summarizing! 🚀**

_Made with ❤️ for the Obsidian community_

</div>
