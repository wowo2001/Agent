# LangChain AI Agent

A simple AI agent built with LangChain.js that can perform calculations and reasoning tasks.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Set your OpenAI API key in `.env`:
   ```
   OPENAI_API_KEY=your_actual_api_key_here
   ```

3. Run the agent:
   ```bash
   node agent.js
   ```

## What it does

The agent can:
- Perform mathematical calculations
- Reason through multi-step problems
- Use tools to solve complex queries

## Extending the agent

You can add more tools by importing them from `@langchain/community/tools` or creating custom tools.