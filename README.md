# TODO features
* implement tag based filter (show text on no result)
* implement MFA support
* implement search by tag
* implement ssh
* implement vpn support (configurable)
* implement bastion support (configurable)
* make required options optional and ask for the data
* test how the app behaves for non MFA access, especially for authentication errors
* add instance id as a pseudo tag, field name: InstanceId

# TODO code
* setup automated testing
* refactor into multiple modules
* refactor the application flow, it feels a bit weird to have the configure() and query() calls in so many places