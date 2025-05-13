# -----------------------------
# 📦 INSTALL DEPENDENCIES
# -----------------------------
# In your Streamlit app, you should have these dependencies installed
# pip install prophet matplotlib pandas requests streamlit --quiet

import pandas as pd
import matplotlib.pyplot as plt
from prophet import Prophet
import requests
import json
import streamlit as st
from io import StringIO

# -----------------------------
# 🔥 STREAMLIT UI SETUP
# -----------------------------
st.title("Crude Products - Commodity Price Forecasting")

st.sidebar.header("Upload Dataset")
uploaded_file = st.sidebar.file_uploader("Upload your 'Crude Data.csv'", type="csv")

if uploaded_file is not None:
    # Load the dataset
    df = pd.read_csv(uploaded_file)
    
    # Display first few rows of the data
    st.write("### Data Preview", df.head())
    
    # Select the product for which the forecast is to be made
    product_name = st.selectbox("Select Product for Forecast", df["Product Name"].unique())
    
    # Filter data for the selected product
    product_df = df[df["Product Name"] == product_name]
    
    # Prepare data
    product_df = product_df[["Date", "Price (USD)", "Product Name"]].rename(columns={"Date": "ds", "Price (USD)": "y"})
    product_df["ds"] = pd.to_datetime(product_df["ds"])

    # -----------------------------
    # 🔮 PROPHET MODEL FOR FORECASTING
    # -----------------------------
    model = Prophet(changepoint_prior_scale=0.5)  # Increased sensitivity to volatility
    model.fit(product_df)

    # -----------------------------
    # 📅 FORECASTING FUTURE PRICES
    # -----------------------------
    future = model.make_future_dataframe(periods=7)
    forecast = model.predict(future)

    # -----------------------------
    # 📈 PLOT FORECAST
    # -----------------------------
    st.write(f"### {product_name} Price Forecast (Next 7 Days)")
    
    fig = model.plot(forecast)
    plt.title(f"{product_name} Price Forecast (Next 7 Days)")
    plt.xlabel("Date")
    plt.ylabel("Price (USD)")
    plt.grid(True)
    
    # Save the plot to be displayed in Streamlit
    st.pyplot(fig)

    # -----------------------------
    # 🔮 AI-POWERED INSIGHT (TOGETHER.AI API)
    # -----------------------------

    # Prepare the forecast summary (use the forecasted 7-day prices)
    summary_df = forecast[["ds", "yhat"]].tail(7)
    summary_text = summary_df.to_string(index=False)

    # Define your prompt for AI insights
    prompt = f"""
    You are a financial analyst and market expert.

    Given this 7-day price forecast for {product_name}:

    {summary_text}

    Provide:
    1. Market trend (rising, falling, or neutral)
    2. Recommended trading strategy (long, short, hold)
    3. Risks or opportunities to watch
    4. Hedging strategy for the next 7 days
    5. Investor approach for the next 7 days
    6. A final actionable, insightful summary

    Respond like a human expert giving investment advice.
    """

    # -----------------------------
    # 🔑 TOGETHER.AI API CALL
    # -----------------------------
    api_key = "895b590f32d6475e94c42ecd8c42ab90b0b83c507bea5ef59b9748a5787f38c5"  # Replace with your Together.ai API key
    together_url = "https://api.together.xyz/v1/chat/completions"

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    payload = {
        "model": "mistralai/Mixtral-8x7B-Instruct-v0.1",  # Use a different model if needed
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.7,
        "max_tokens": 500
    }

    # Make the API call
    response = requests.post(together_url, headers=headers, data=json.dumps(payload))

    # -----------------------------
    # 🧠 DISPLAY AI INSIGHT
    # -----------------------------
    if response.status_code == 200:
        insight = response.json()['choices'][0]['message']['content']
        st.write("\n🧠 AI Market Insight:\n")
        st.write(insight)
    else:
        st.write(f"Error from Together.ai: {response.status_code} - {response.text}")

else:
    st.write("Upload your CSV file to begin.")
