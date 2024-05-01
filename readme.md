# Current Commands
* Screenshot
!sc [title]

Takes a screenshot and sends it to discord.

There is also an optional screenshot preview browser source

* ToggleFilter
!setfilter [sourceName] [filterName] [on|off]

Command to toggle a filter on or off on a source.

# Install Instructions 
1. Install node: https://nodejs.org/en
2. Open command prompt in root folder and run "npm install"
3. Make a copy of data/configTemplate.json and call it config.json
4. Open data/config.json and edit to suit your needs.
	- OBS Websocket password
	- Twitch Bot token and details
	- Discord webhook for screenshots
5. Setup command shortcuts in config.json