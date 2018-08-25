zip -r ~/Downloads/lambda.zip .

aws lambda update-function-code --function-name generate-cfb-calendars \
--zip-file fileb://~/Downloads/lambda.zip --region us-east-2 --profile hathaway