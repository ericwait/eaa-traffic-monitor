# README

I would like to create an app that helps me monitor multiple websites and audio streams at once for the traffic going in and out of Oshkosh during the EAA annual airshow.
There are three main ways of monitoring the air traffic in and out of Oshkosh that I would like this app to manage.
These include audio streams, YouTube live feeds, and live flight radar information.

## Audio Streams

I have `.pls` uRLs, that stream live radio content from the towers approach and departures.
I would like to listen to multiple streams at once.
This is the most complex and overwhelming part of monitoring traffic.
Having multiple audio streams are OK when people aren't talking at the same time but as soon as there are radio calls across multiple of these channels, it gets really hard to understand one of them.
The features for this that could help with the overload of information are:

- **Volume Control**: Ability to adjust the volume of each stream independently.
- **Mute/Unmute**: Quickly mute or unmute individual streams.
- **Audio Visualization**: Visual indicators for active streams, such as waveform displays or activity lights, to help identify which streams are currently active. Meaning that if there is no activity on a stream, it should be visually indicated that the stream is quiet. If there is activity, it should be visually indicated that the stream is active. This will help me understand which stream the autio is coming from.
- **Audio Prioritization**: Implement a system to prioritize certain streams over others, allowing the user to focus on the most critical communications.
- **User Interface**: A clean and intuitive user interface that allows for easy management of multiple streams, including the ability to add, remove, and organize streams as needed.

## Live YouTube Feeds

EAA provides many live channels on YouTube.
I would like to watch one or many of these channels, all at once in the same interface.
Ideally, we only take the eye frames and maybe overlay the video with which stream it's coming from.
I would like the ability to tile the streams in either a regular grid or in ways where I can promote or emphasize one of the channels.
I would also like the ability to full screen one of those channels.
I would also like to be able to pop up additional windows to put on different monitors with these channels, one or many.

- **Grid Layout**: Ability to arrange multiple YouTube live feeds in a grid layout for simultaneous viewing.
- **Stream Emphasis**: Options to emphasize or highlight a particular stream, such as enlarging it or bringing it to the forefront of the interface.
- **Full-Screen Mode**: Ability to switch any stream to full-screen mode for focused viewing.
- **Multi-Monitor Support**: Capability to pop out streams into separate windows for display on different monitors.
- **Stream Identification**: Overlay stream identifiers or labels on each feed to easily distinguish between different channels.
- **User Interface**: A user-friendly interface that allows for easy management of multiple YouTube feeds, including adding, removing, and organizing streams.
- **Performance Optimization**: Ensure smooth playback of multiple streams simultaneously without significant lag or buffering issues.
- **Audio Control**: If the YouTube feeds have audio, provide controls to manage the volume or mute/unmute each feed independently.
- **Customization Options**: Allow users to customize the layout, appearance, and behavior of the YouTube feed interface to suit their preferences and workflow.
- **Integration with Other Features**: Ensure seamless integration with the audio streams and live flight radar information, allowing users to monitor all aspects of air traffic in a unified interface.

## Live Flight Radar Information

 lastly, I'd like to integrate flight radar 24 as my live air traffic window.
 I don't think this website has an iframe or way to embed, so we may have to use a browser panel and allow full browser style navigation of that website.
  This should integrate with the live YouTube feeds, but be allowed to have its own emphasis separate from the YouTube feed.
  In other words, I may want to have an emphasized video for my feed grid, and then the ability to resize the flight tracker independent of those videos.

- **Browser Panel**: Implement a browser panel that allows users to navigate and interact with the Flight Radar 24 website directly within the app.
- **Resizable Window**: Allow users to resize the flight radar panel independently of the YouTube feed grid, providing flexibility in how they monitor air traffic information.
- **Integration with YouTube Feeds**: Ensure that the flight radar panel can be integrated with the YouTube feed grid, allowing users to monitor both video feeds and live flight information simultaneously.
- **Emphasis Control**: Provide options to emphasize or highlight the flight radar panel, similar to the YouTube feed emphasis feature, allowing users to focus on the most critical information as needed.
- **User Interface**: Design a user-friendly interface that allows for easy navigation and interaction with the flight radar panel, including options to zoom in, pan, and access additional flight information as needed.
- **Performance Optimization**: Ensure that the flight radar panel operates smoothly within the app, without significant lag or performance issues, even when multiple streams and feeds are being monitored simultaneously.
- **Customization Options**: Allow users to customize the appearance and behavior of the flight radar panel to suit their preferences and workflow, including options for different map views, filters, and data overlays.
- **Integration with Other Features**: Ensure seamless integration with the audio streams and YouTube feeds, allowing users to monitor all aspects of air traffic in a unified interface.
- **Data Refresh and Updates**: Implement automatic data refresh and updates for the flight radar panel to ensure that users have access to the most current air traffic information at all times.
