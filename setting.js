const fs = require("fs");
const chalk = require('chalk');
const moment = require("moment-timezone");

global.PAKASIR_API_KEY = "iRYxp0CEkTey9IaP7yrGG4ygNGyeVJ37"
global.PAKASIR_PROJECT_SLUG = "oumanlin"
//Setting
global.urlBot = 'https://t.me/ouman_bot'
global.BOT_TOKEN = "8564970869:AAEzni0_WfxAm9FJIrv20Qjr7PPjDR-pbvk" //Create bot here https://t.me/BotFather and get the bot token
global.BOT_NAME = "Ouman, Bot Auto Order 24 Hours |By @oumanlin " //Your bot name
global.OWNER_ID = "8379278966" //Your id
global.OWNER_NAME = "Oumanlin" //Your name
global.OWNER_NUMBER = "6285169691602" //Your Telegram number
global.OWNER = ["https://t.me/oumanlin"] //Pastikan username sudah sesuai agar fitur khusus owner bisa di pakai
global.CHANNEL = "https://t.me/+CD-gQ9Hd7hM1MDY1" //Your Telegram channel 

//Images
global.thumbnail = "./options/image/thumbnail.jpg"

/// Message
global.mess = {
  sukses: "Done🤗",
  admin: "Command ini hanya bisa digunakan oleh Admin Grup",
  botAdmin: "Bot Harus menjadi admin",
  owner: "Command ini hanya dapat digunakan oleh owner bot",
  prem: "Command ini khusus member premium",
  group: "Command ini hanya bisa digunakan di grup",
  private: "Command ini hanya bisa digunakan di Private Chat",
  wait: "⏳ Mohon tunggu sebentar...",
  error: {
    lv: "Link yang kamu berikan tidak valid",
    api: "Maaf terjadi kesalahan"
  }
}


let time = moment(new Date()).format('HH:mm:ss DD/MM/YYYY')
let file = require.resolve(__filename)
fs.watchFile(file, () => {
  fs.unwatchFile(file)
  console.log(chalk.greenBright(`[ ${BOT_NAME} ]  `) + time + chalk.cyanBright(` "${file}" Telah diupdate!`))
  delete require.cache[file]
  require(file)
})