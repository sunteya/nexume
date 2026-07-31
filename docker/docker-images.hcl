group "default" {
  targets = ["image"]
}

target "image" {
  context    = "."
  dockerfile = "docker/Dockerfile"
  platforms = ["linux/amd64", "linux/arm64"]
  tags      = ["sunteya/nexume:0.1.0"]
}
