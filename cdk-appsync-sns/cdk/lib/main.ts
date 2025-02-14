import * as sns from '@aws-cdk/aws-sns'
import * as cdk from '@aws-cdk/core'
import * as appsync from '@aws-cdk/aws-appsync'
import { join } from 'path'

const REQUEST_TEMPLATE = `
#set ($topicArn = $util.urlEncode("__TOPIC_ARN__"))
#set ($body = "Action=Publish&Version=2010-03-31&TopicArn=$topicArn")
#set ($obj = $ctx.args)
#set ($message = $util.urlEncode($util.toJson($obj)))
#set ($body = "$body&Message=$message")

{
  "version": "2018-05-29",
  "method": "POST",
  "resourcePath": "/",
  "params": {
    "body": "$body",
    "headers": {
      "content-type": "application/x-www-form-urlencoded"
    }
  }
}
`

const RESPONSE_TEMPLATE = `
#if($ctx.result.statusCode == 200)
    ##if response is 200
    ## Because the response is of type XML, we are going to convert
    ## the result body as a map and only get the User object.
    $utils.toJson($utils.xml.toMap($ctx.result.body).PublishResponse.PublishResult)
#else
    ##if response is not 200, append the response to error block.
    $utils.appendError($ctx.result.body, "$ctx.result.statusCode")
#end
`

export class CdkAppSyncSnSStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    const region = cdk.Stack.of(this).region

    const api = new appsync.GraphqlApi(this, 'Api', {
      name: 'ToSnSApi',
      schema: appsync.Schema.fromAsset(join(__dirname, 'schema.graphql')),
    })

    const topic = new sns.Topic(this, 'topic')
    const datasource = api.addHttpDataSource('sns', `https://sns.${region}.amazonaws.com`, {
      authorizationConfig: { signingRegion: region, signingServiceName: 'sns' },
    })
    datasource.node.addDependency(topic)
    topic.grantPublish(datasource.grantPrincipal)

    datasource.createResolver({
      typeName: 'Query',
      fieldName: 'publish',
      requestMappingTemplate: appsync.MappingTemplate.fromString(
        REQUEST_TEMPLATE.replace('__TOPIC_ARN__', topic.topicArn)
      ),
      responseMappingTemplate: appsync.MappingTemplate.fromString(RESPONSE_TEMPLATE),
    })

    new cdk.CfnOutput(this, 'graphqlUrl', { value: api.graphqlUrl })
    new cdk.CfnOutput(this, 'apiKey', { value: api.apiKey! })
    new cdk.CfnOutput(this, 'apiId', { value: api.apiId })
    new cdk.CfnOutput(this, 'topicName', { value: topic.topicName })
  }
}
