#!/usr/bin/env node

// TODO move parts into different locations
// TODO add hacked mfa support

const program = require('commander');
const AWS = require('aws-sdk');
const fs = require('fs');
const ini = require('ini');

program
    .version('0.1.0')
    .option('-p, --profile <string>', 'Specify aws profile')
    .option('-f, --filter [string]', 'Filter results')
    .parse(process.argv);


if (!program.profile) {
    console.log('Please specify an aws profile');
    return;
}

AWS.config.region = 'eu-west-1';
AWS.config.apiVersions = {
    ec2: '2016-11-15'
};

let configIni = ini.parse(fs.readFileSync(
    `${process.env.HOME}/.aws/config`,
    'utf-8'
));
let awsProfileConfig = configIni[`profile ${program.profile}`];
if (awsProfileConfig && awsProfileConfig.role_arn) {
    let roleArn = awsProfileConfig.role_arn.replace(/:/g, '_').replace(/[^A-Za-z0-9\-_]/g, '-');
    let awsCliCacheFilename = `${program.profile}--${roleArn}`;
    let awsCliCache =
        JSON.parse(fs.readFileSync(
            `${process.env.HOME}/.aws/cli/cache/${awsCliCacheFilename}.json`,
            'utf-8'
        ));
    let sts = new AWS.STS();
    AWS.config.credentials = sts.credentialsFrom(awsCliCache, awsCliCache);
}


const ec2 = new AWS.EC2();

ec2.describeInstances({}, function (error, data) {
    if (error) {
        console.log(error, error.stack);
    } else {

        const instances = data.Reservations.map((item) => {
            // TODO when is there more than one?
            const privateIp = item.Instances[0].NetworkInterfaces[0].PrivateIpAddress;
            const tags = item.Instances[0].Tags
                                          //.map((item) => {
                                          //    const tag = {};
                                          //    tag[item.Key] = item.Value;
                                          //    return tag;
                                          //})
                                          .reduce((accumulator, item) => {
                                              //console.log(item);
                                              accumulator[item.Key] = item.Value;
                                              return accumulator;
                                          }, {});

            return {
                privateIp: privateIp,
                tags: tags
            };
        });

        processResults(instances);
    }
});


function processResults(instances) {
    //console.log(JSON.stringify(instances, null, 2));

    instances
        .sort((a, b) => {

            if (!a.tags['Name']) {
                return 1;
            } else if (!b.tags['Name']) {
                return -1;
            }

            return a.tags['Name'].localeCompare(b.tags['Name'])
        })
        .filter((instance) => {
            return Object.values(instance.tags).find((tag) => {

                //console.log(tag + ': ' + (tag.search(program.filter) > -1));
                return tag.search(program.filter) > -1;
            });
        })
        .forEach((instance) => {
            console.log(instance.tags['Name'] + ': ' + instance.privateIp);
        });
}