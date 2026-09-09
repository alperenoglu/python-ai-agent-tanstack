import os
from openai import OpenAI

client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))

messages = []

while True:
    user_input = input("You: ")
    if user_input.strip().lower() in ("exit", "quit"):
        break
    
    messages.append({"role": "user", "content": user_input})


    response = client.chat.completions.create(
        model="gpt-5-mini",
        messages=[{"role": "user", "content": user_input}],
    )

    reply = response.choices[0].message.content
    messages.append({"role": "assistant", "content": reply})
    print("Bot:", reply)
