import { Config } from '@remotion/cli/config'

// Os vídeos e a marca moram no public/ do app Next, na raiz do repositório.
// Apontar o publicDir para lá evita duplicar arquivo pesado dentro deste projeto:
// staticFile('videos/aluno.mp4') resolve em ../public/videos/aluno.mp4.
Config.setPublicDir('../public')

Config.setVideoImageFormat('jpeg')
Config.setCodec('h264')
// CRF 20: qualidade alta o bastante para texto de UI ficar legível depois do
// recompressão do WhatsApp, sem gerar arquivo que não passa no anexo de e-mail.
Config.setCrf(20)
Config.overrideWebpackConfig((c) => c)
