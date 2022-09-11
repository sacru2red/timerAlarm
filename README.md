## 디스코드 앱, 봇 만들기

https://discord.com/developers/docs/getting-started

## 로컬에서 구동하기

### Windows

[chocolatey 다운로드](https://chocolatey.org/install)
nodejs 설치

```
choco install nodejs-lts
```

git 설치

```
choco install git
```

저장소 복제

```
mkdir timerAlarm
cd timerAlarm
git clone https://github.com/sacru2red/timerAlarm
```

패키지 설치

```
npm install
```

env 파일 수정 (앱 만들기에서 설정된 값으로)

```
/.env.sample => /.env copy and edit
```

ngrok 설치

```
choco install ngrok
```

ngrok 실행

```
ngrok http 3000
```

Forwarding 값 확인 후 디스코드 앱의 인터랙션 엔드포인트 URL(INTERACTIONS ENDPOINT URL) 변경

```
Forwarding                    https://b25e-220-119-201-230.jp.ngrok.io -> http://localhost:3000
```

```
INTERACTIONS ENDPOINT URL
https://b25e-220-119-201-230.jp.ngrok.io/interactions
```

### Run the app

After your credentials are added, go ahead and run the app:

```
node app.js
```

> ⚙️ A package [like `nodemon`](https://github.com/remy/nodemon), which watches for local changes and restarts your app, may be helpful while locally developing.

### Set up interactivity

The project needs a public endpoint where Discord can send requests. To develop and test locally, you can use something like [`ngrok`](https://ngrok.com/) to tunnel HTTP traffic.

Install ngrok if you haven't already, then start listening on port `3000`:

```
ngrok http 3000
```

You should see your connection open:

```
Tunnel Status                 online
Version                       2.0/2.0
Web Interface                 http://127.0.0.1:4040
Forwarding                    http://1234-someurl.ngrok.io -> localhost:3000
Forwarding                    https://1234-someurl.ngrok.io -> localhost:3000

Connections                  ttl     opn     rt1     rt5     p50     p90
                              0       0       0.00    0.00    0.00    0.00
```

Copy the forwarding address that starts with `https`, in this case `https://1234-someurl.ngrok.io`, then go to your [app's settings](https://discord.com/developers/applications).

On the **General Information** tab, there will be an **Interactions Endpoint URL**. Paste your ngrok address there, and append `/interactions` to it (`https://1234-someurl.ngrok.io/interactions` in the example).

Click **Save Changes**, and your app should be ready to run 🚀

## Other resources

- Read **[the documentation](https://discord.com/developers/docs/intro)** for in-depth information about API features.
- Browse the `examples/` folder in this project for smaller, feature-specific code examples
- Join the **[Discord Developers server](https://discord.gg/discord-developers)** to ask questions about the API, attend events hosted by the Discord API team, and interact with other devs.
- Check out **[community resources](https://discord.com/developers/docs/topics/community-resources#community-resources)** for language-specific tools maintained by community members.
