const OBSWebSocket = require('obs-websocket-js').default;
const tmi = require('tmi.js');
const fs = require('fs');
const async = require('async');
const { DateTime } = require("luxon");
const request = require('request-promise');

const PermissionEnum = {
	Mod: "mod",
	Sub: "sub",
	Streamer: "streamer"
};


class OBSCommander {

	constructor(config) {
		this.config = config;
		this.commands = [
			{
				Name: "Screenshot",
				Command: "sc",
				Aliases: ["p"],
				Permissions: [],
				Action: this.takeScreenshot.bind(this),
			},
			{
				Name: "ToggleFilter",
				Command: "setfilter",
				Aliases: [],
				Permissions: [PermissionEnum.Mod],
				Action: this.cmdToggleFilter.bind(this),
			}
		];
		this.config.Command_Shortcuts.forEach(cmd => {
			var base = this.commands.find(e => e.Name == cmd.Base_Command);
			if (!base) return;
			this.commands.push({
				Name: cmd.Name,
				Command: cmd.Command,
				Permissions: cmd.Permissions ?? base.Permissions,
				Action: (msg) => {
					this.overrideArguments(msg, cmd.Args);
					base.Action(msg);
				}
			})
		})
		this.start();
	}

	start() {
		async.waterfall([
			next => { // OBS
				this.obs = new OBSWebSocket();
				this.connectToOBS(err => {
					if (err) {
						next({Message: "OBS Connect Error", Error: err});
						return;
					}
					this.initScreenshots();
					next();
				});
			},
			next => {
				const conf = {
					identity: {
						username: this.config.Twitch.Bot_Username,
						password: this.config.Twitch.Bot_Token,
					},
					channels: [ this.config.Twitch.Channel ]
				};
				this.twitchClient = new tmi.Client(conf);
				this.connectToTwitch(err => {
					if (err) {
						this.obs.disconnect();
						next({Message: "Twitch Connect Error", Error: err});
						return;
					}
					next();
				});
			}
		], (err) => {
			if (err) {
				return console.log("Failed to Start: ", err.Message, err.Error.message);
			}
			this.twitchClient.on('message', this.onTwitchMessage.bind(this));
			this.twitchClient.on("disconnected", (reason) => {
				console.log("Disconnected from Twitch: ", reason);
				this.connectToTwitch(err => {
					if (err) console.log("Failed to reconnect to Twitch.", err);
				});
			});
			this.obs.on("ConnectionClosed", err => {
				console.log("Disconnected from OBS: ", err.Message);
				this.connectToOBS(err => {
					if (err) console.log("Failed to reconnect to OBS.", err);
				});
			});
		})
	}

	connectToTwitch(callback) {
		this.twitchClient.connect()
		.then(() => {
			console.log(`Connected to Twitch chat as ${this.config.Twitch.Bot_Username}`);
			callback();
		})
		.catch(err => {
			console.error(`Failed to connect to Twitch chat: ${err}`);
			callback(err);
		});
	}

	connectToOBS(callback) {
		this.obs.connect(this.config.OBS.Address, this.config.OBS.Password)
		.then(() => {
			console.log(`Connected to OBS`);
			this.obs.call("GetVersion").then(res => {
				this.imageFormat = ImageFormatPref.find(pref => res.supportedImageFormats.includes(pref)); //find the first one that matches our preference
				callback();
			}).catch(err => {
				console.error(`Failed to query OBS: ${err}`);
				callback(err);
			});
		})
		.catch(err => {
			console.error(`Failed to connect to OBS: ${err}`);
			callback(err);
		});
	}

	onTwitchMessage(channel, tags, message, self) {
		// Ignore messages from the bot itself
		if (self) return;
		if (!message.startsWith("!")) return; //not a command
	  
		// Parse the command and arguments
		// const [cmd, ...args] = message.substring(1).trim().split(/\s+/);
		const [cmd, ...args] = this.getMessageArguments(message.substring(1));

		// Handle the command
		var command = this.commands.find(e => e.Command == cmd.toLowerCase() || e.Aliases.includes(cmd.toLowerCase()));
		if (command) {
			var msg = {
				Command: command,
				Cmd: cmd,
				Args: args,
				IsStreamer: tags.badges?.broadcaster == 1,
				IsMod: tags.mod,
				IsSub: tags.subscriber,
				Username: tags["display-name"] ?? tags.username,
				Message: message,
				Tags: tags,
			}
			this.executeCommand(msg);
		}	  
	}

	getMessageArguments(commandString) {
		// Regular expression to match both quoted and unquoted arguments
		const regex = /"([^"]+)"|(\S+)/g;
		const argumentsArray = [];
		let match;
	
		// Iterate over matches and extract the arguments
		while ((match = regex.exec(commandString)) !== null) {
			// Matched text is stored in the 1st capture group if quoted, 2nd capture group if unquoted
			const argument = match[1] !== undefined ? match[1] : match[2];
			argumentsArray.push(argument);
		}
	
		return argumentsArray;
	}

	overrideArguments(msg, overrideArgs) {
		var args = [];
		for (var i in overrideArgs) {
			args.push(overrideArgs[i]);
		}
		for (var i in msg.Args) {
			args.push(msg.Args[i]);
		}
		msg.Args = args;
	}

	executeCommand(msg) {
		const command = msg.Command;
		const args = msg.Args;
		var valid = command.Permissions.every(perm => {
			if (msg.IsStreamer) return true;
			switch(perm) {
				case "mod":
					return msg.IsMod;
				case "sub":
					return msg.IsSub;
			}
		});
		if (!valid) return console.log(`User ${msg.Username} tried to run command ${command.Name}, but does not have permission`);
		
		console.log(`User ${msg.Username} running command ${command.Name}`);

		command.Action(msg);
		
	}

	sendMessage(msg) {
		this.twitchClient.say(this.config.Twitch.Channel, msg);
	}	

	obsCommand(cmd, options, callback) {
		this.obs.call(cmd, options)
		.then(res => {
			if (typeof(callback) == "function") callback({Success: true, Data: res});
		})
		.catch(err => {
			if (typeof(callback) == "function") callback({Success: false, Error: err});
		})
	}

	initScreenshots() {
		this.obs.call("GetSceneItemId", {
			"sceneName": this.config.Screenshots.Live_Scene,
			"sourceName": this.config.Screenshots.Preview_Source
		}).then(res => {
			this.screenshotPreviewId = res.sceneItemId;
		}).catch(err => {
			console.log(err);
		})
	}


	takeScreenshot(msg) {
		this.config.Screenshots.Source_Names.forEach(src => {
			this.obs.call("GetSourceScreenshot", {
				"sourceName": src,
				"imageFormat": this.imageFormat
			}).then(res => {
				const base64Image = res.imageData.replace(/^data:image\/\w+;base64,/, '')
				const buffer = Buffer.from(base64Image, "base64");

				this.showScreenshotPreview(msg, buffer);
				this.sendScreenshotToDiscord(msg, buffer);
				
			}).catch(err => {
				if (err.message.includes("Failed to render screenshot")) {
					return console.log(`Screenshot Source [${src}] is offline`);
				}
				return console.log("Failed to get Screenshot:", err);
			})
		})
		
	}

	showScreenshotPreview(msg, buffer) {
		fs.writeFile(`${process.cwd()}/Preview/Screenshot.${this.imageFormat}`, buffer, (err) => {
			if (err) return console.log(err);
			if (!this.screenshotPreviewId) return;
			if (this.screenshotHideTimeout) clearTimeout(this.screenshotHideTimeout); //Don't hide it
			this.obsCommand("SetSceneItemEnabled", { //Hide it first
				"sceneItemEnabled": false,
				"sceneItemId": this.screenshotPreviewId,
				"sceneName": this.config.Screenshots.Live_Scene,
			}, res => {
				if (!res.Success) return console.log(res.Error);
				setTimeout(() => {
					this.obsCommand("SetSceneItemEnabled", { //Show it
						"sceneItemEnabled": true,
						"sceneItemId": this.screenshotPreviewId,
						"sceneName": this.config.Screenshots.Live_Scene,
					});
				}, 1000);
				this.screenshotHideTimeout = setTimeout(() => {
					this.screenshotHideTimeout = null;
					this.obsCommand("SetSceneItemEnabled", {
						"sceneItemEnabled": false,
						"sceneItemId": this.screenshotPreviewId,
						"sceneName": this.config.Screenshots.Live_Scene,
					});
				}, 20000);
			});
		});
	}

	sendScreenshotToDiscord(msg, buffer) {
		const text = `Screenshot from ${msg.Username}: ${msg.Args.join(" ")}`;
				
		request(this.config.Discord.Webhook, {
			method: "POST",
			formData: {
				"file1": {
					"value": buffer,
					  "options": {
						"filename": `screenshot.${this.imageFormat}`,
						"contentType": null
					  }
				},
				"payload_json": JSON.stringify({
					content: text,
				}),
			}
		})
		.then(res => {
			this.sendMessage(`${msg.Username}'s Screenshot saved to Discord!`);
		})
		.catch(err => {
			console.log("Failed to post Screenshot to Discord");
		})
	}

	cmdToggleFilter(msg) {
		const sourceName = msg.Args[0];
		const filterName = msg.Args[1];
		var state = msg.Args[2];
		if (sourceName === undefined || filterName === undefined || state === undefined) {
			return this.sendMessage("Usage: !setfilter <source_name> <filter_name> <on|off>");
		}
		state = ["on", "true", "yes"].includes(state.toLowerCase());
		this.obsCommand("SetSourceFilterEnabled", {
			sourceName: sourceName,
			filterName: filterName,
			filterEnabled: state
		}, res => {
			if (!res.Success) {
				if (res.Error.message.includes("No filter was found")) this.sendMessage("Filter Not Found!");
			}
			if (res.Success && res.Data === undefined) {
				return this.sendMessage(`Filter ${state ? "Enabled" :  "Disabled"}`);
			}
		})
	}
}

const ImageFormatPref = [
	"jpg",
	"png",
	"jpeg",
	"bmp"
];

module.exports = OBSCommander;